import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { runCampaignProcessOnce } from "@/lib/campaigns/campaign-job-service";
import type { SupabaseAdmin } from "@/lib/chat/types";

export const runtime = "nodejs";

/**
 * Dispatcher server-side de campañas WhatsApp en estado 'sending'.
 * Protegido por CRON_SECRET (Bearer). Reemplaza la dependencia del poll del navegador:
 * la campaña avanza sola aunque el usuario cierre la pantalla.
 *
 * - Busca campañas 'sending' y procesa lotes con runCampaignProcessOnce().
 * - SEGURO contra duplicados: el claim atómico (FOR UPDATE SKIP LOCKED) hace que este cron
 *   y cualquier poll del navegador tomen destinatarios DISJUNTOS (nunca el mismo dos veces).
 * - Acotado por tick: hasta `maxBatches` lotes por campaña (default 20 = 500 destinatarios);
 *   lo que sobra continúa en el próximo tick. Evita timeouts en campañas grandes.
 * - dryRun=1 → solo lista campañas 'sending', no envía.
 * - Idempotente: solo toca 'queued' → 'sending' → 'sent'/'failed'. No reprocesa enviados.
 *
 * Programar cada ~30-60s en Coolify (scheduled task), igual que cc-push-dispatch.
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}
function parseBool(v: string | null): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = parseBool(url.searchParams.get("dryRun"));
  const maxBatches = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("maxBatches") ?? "20", 10) || 20)
  );
  const batchSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("batchSize") ?? "25", 10) || 25)
  );

  let sb0;
  try {
    sb0 = createServiceRoleClient();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `cliente service-role no disponible: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const { data: sending, error: qErr } = await sb0
    .from("chat_campaigns")
    .select("id, empresa_id, name")
    .eq("status", "sending")
    .order("started_at", { ascending: true })
    .limit(50);

  if (qErr) {
    return NextResponse.json({ ok: false, error: `query sending falló: ${qErr.message}` }, { status: 500 });
  }

  const campaigns = (sending ?? []) as Array<{ id: string; empresa_id: string; name: string | null }>;
  const results: Array<Record<string, unknown>> = [];

  for (const c of campaigns) {
    if (dryRun) {
      results.push({ campaign: c.id, name: c.name, dry_run: true });
      continue;
    }
    try {
      const sb = await getChatServiceClientForEmpresa(c.empresa_id);
      let processedTotal = 0;
      let batches = 0;
      let completed = false;
      let remaining = 0;
      while (batches < maxBatches) {
        const r = await runCampaignProcessOnce({
          supabase: sb as unknown as SupabaseAdmin,
          empresaId: c.empresa_id,
          campaignId: c.id,
          batchSize,
        });
        processedTotal += r.processed;
        batches += 1;
        remaining = r.remainingQueued;
        if (r.campaignCompleted) {
          completed = true;
          break;
        }
        // Nada pendiente, o el lote no procesó nada (otro runner tiene el resto reclamado):
        // cortamos y seguimos en el próximo tick.
        if (r.remainingQueued === 0 || r.processed === 0) break;
      }
      results.push({
        campaign: c.id,
        name: c.name,
        processed: processedTotal,
        batches,
        remaining_queued: remaining,
        completed,
      });
    } catch (e) {
      results.push({
        campaign: c.id,
        name: c.name,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    campaigns_sending: campaigns.length,
    results,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
