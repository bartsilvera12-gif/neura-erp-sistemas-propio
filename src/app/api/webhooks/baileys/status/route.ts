/**
 * Webhook de ACTUALIZACIÓN DE ESTADO del canal WhatsApp QR (Baileys).
 *
 * Lo llama el puente Baileys cuando WhatsApp le notifica un cambio de estado
 * de un mensaje saliente (sent/delivered/read/failed — equivalente al evento
 * `messages.update` de Baileys). Sin esto, los mensajes mandados por el ERP
 * se quedan sin tildes y el asesor cree que "no llegaron".
 *
 * Cuerpo esperado (JSON):
 *   { empresaId, waMessageId, status, timestamp? }
 *   status ∈ { "sent", "delivered", "read", "failed" }
 *
 * Mismo patrón de refuerzo monotónico que YCloud: no degrada un estado ya
 * alcanzado (p.ej. no vuelve de "read" a "delivered"), y `failed` es terminal.
 *
 * Seguridad: header `x-bridge-secret` debe coincidir con `BAILEYS_BRIDGE_SECRET`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import type { SupabaseAdmin } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
const LOG = "[webhooks/baileys/status]";

type EstadoBaileys = "sent" | "delivered" | "read" | "failed";

/** Orden del flujo positivo; `failed` se trata aparte. */
function rankPositivo(s: string): number {
  if (s === "sent") return 1;
  if (s === "delivered") return 2;
  if (s === "read") return 3;
  return 0;
}

export async function POST(request: NextRequest) {
  const secret = (process.env.BAILEYS_BRIDGE_SECRET || "").trim();
  if (!secret) {
    console.error(LOG, "BAILEYS_BRIDGE_SECRET no configurado en el servidor");
    return NextResponse.json({ ok: false, error: "bridge_secret_not_configured" }, { status: 500 });
  }
  const provided = (request.headers.get("x-bridge-secret") || "").trim();
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "json_invalido" }, { status: 400 });
  }

  const empresaId = String(body?.empresaId ?? "").trim();
  const waMessageId = String(body?.waMessageId ?? "").trim();
  const statusRaw = String(body?.status ?? "").trim().toLowerCase();
  const timestamp = typeof body?.timestamp === "string" ? body.timestamp : null;

  if (!empresaId || !waMessageId || !statusRaw) {
    return NextResponse.json(
      { ok: false, error: "faltan campos: empresaId, waMessageId, status" },
      { status: 400 }
    );
  }
  if (!(["sent", "delivered", "read", "failed"] as const).includes(statusRaw as EstadoBaileys)) {
    // No es error — pueden venir estados que no nos interesan reflejar.
    return NextResponse.json({ ok: true, skipped: true, reason: `status_no_relevante:${statusRaw}` });
  }
  const status = statusRaw as EstadoBaileys;

  try {
    const sb = (await getChatServiceClientForEmpresa(empresaId)) as unknown as SupabaseAdmin;

    const { data: row, error: selErr } = await sb
      .from("chat_messages")
      .select("id, whatsapp_delivery_status, whatsapp_delivered_at, whatsapp_read_at, raw_payload")
      .eq("empresa_id", empresaId)
      .eq("wa_message_id", waMessageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) {
      console.warn(LOG, "select_fallo", selErr.message);
      return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 });
    }
    if (!row) {
      // No es error del bridge: pudo haber mandado el mensaje por fuera del ERP
      // (p. ej. el asesor contestó desde su propio celular). Devolvemos ok para
      // que el bridge no reintente eternamente.
      console.info(LOG, "mensaje_no_encontrado", { empresa_id: empresaId, waMessageId, status });
      return NextResponse.json({ ok: true, not_found: true });
    }

    const r = row as {
      id?: string;
      whatsapp_delivery_status?: string | null;
      raw_payload?: unknown;
    };
    const cur = String(r.whatsapp_delivery_status ?? "").toLowerCase();

    // Guarda monotónica: no pisar un estado terminal/superior.
    if (cur === "failed") {
      return NextResponse.json({ ok: true, idempotente: true, de: cur, intento: status });
    }
    if (status === "failed") {
      if (cur === "delivered" || cur === "read") {
        // failed tardío sobre un mensaje que ya llegó: lo ignoramos.
        return NextResponse.json({ ok: true, ignorado_failed_tardio: true, de: cur });
      }
    } else if (rankPositivo(status) <= rankPositivo(cur)) {
      return NextResponse.json({ ok: true, no_degrada: true, de: cur, intento: status });
    }

    const ts = timestamp ?? new Date().toISOString();
    const prevRaw = r.raw_payload;
    const mergedRaw = {
      ...(prevRaw && typeof prevRaw === "object" && !Array.isArray(prevRaw)
        ? (prevRaw as Record<string, unknown>)
        : {}),
      neura_baileys_status: {
        status,
        receivedAt: new Date().toISOString(),
      },
    };

    const patch: Record<string, unknown> = {
      whatsapp_delivery_status: status,
      raw_payload: mergedRaw,
    };
    if (status === "delivered") patch.whatsapp_delivered_at = ts;
    if (status === "read") {
      patch.whatsapp_read_at = ts;
      // Si llega `read` sin `delivered` previo, inferimos entrega al mismo ts.
      patch.whatsapp_delivered_at = ts;
    }

    const rowId = String(r.id ?? "");
    if (!rowId) return NextResponse.json({ ok: false, error: "row_sin_id" }, { status: 500 });

    const { error: updErr } = await sb
      .from("chat_messages")
      .update(patch)
      .eq("id", rowId)
      .eq("empresa_id", empresaId);
    if (updErr) {
      console.warn(LOG, "update_fallo", updErr.message);
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    console.info(LOG, "aplicado", { empresa_id: empresaId, message_id: rowId, de: cur || null, a: status });
    return NextResponse.json({ ok: true, de: cur || null, a: status });
  } catch (err) {
    console.error(LOG, "error", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
