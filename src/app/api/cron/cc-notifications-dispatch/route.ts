import { NextRequest, NextResponse } from "next/server";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { getFcmMessaging } from "@/lib/cc/firebase-admin";

export const runtime = "nodejs";

/**
 * Dispatcher de notificaciones push (FCM) del Contact Center.
 * Protegido por CRON_SECRET (Bearer). Procesa agent_notification_events pending/fcm.
 *
 * - Busca eventos pending → tokens activos del agente → envía push con Firebase Admin.
 * - Marca sent (con provider_message_id) o failed (con error_message); skipped si no hay device.
 * - Idempotente: solo toca pending → sent/failed/skipped (no reprocesa, no duplica).
 * - dryRun=1 → solo cuenta, no envía ni marca.
 * - Si faltan credenciales Firebase → responde config_missing y deja los eventos pending.
 * - Desactiva tokens inválidos (registration-token-not-registered).
 * - No imprime secretos.
 *
 * Programar cada ~1 min en Coolify cuando se active (hoy NO programado).
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

const TITLES: Record<string, string> = {
  new_lead: "Nuevo lead asignado",
  new_message: "Nuevo mensaje",
  reassigned: "Conversación reasignada",
  sla_warning: "Lead sin responder",
};

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = parseBool(url.searchParams.get("dryRun"));
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));

  let schema: string;
  try {
    schema = assertAllowedChatDataSchema((process.env.APP_DB_SCHEMA ?? "neura").trim());
  } catch {
    return NextResponse.json({ ok: false, error: "schema inválido" }, { status: 500 });
  }
  const pool = getChatPostgresPool();
  if (!pool) return NextResponse.json({ ok: false, error: "pool no disponible" }, { status: 500 });

  const fcm = await getFcmMessaging();
  if (!fcm.ok && fcm.reason === "config_missing" && !dryRun) {
    return NextResponse.json(
      {
        ok: false,
        error: "config_missing",
        missing: fcm.missing,
        hint: "Configurar credenciales Firebase en Coolify (ver FIREBASE/CAPACITOR docs). Los eventos quedan pending.",
      },
      { status: 200 }
    );
  }

  let pend;
  try {
    pend = await pool.query(
      `SELECT id, agent_id, conversation_id, type
         FROM "${schema}".agent_notification_events
        WHERE status='pending' AND channel='fcm'
        ORDER BY created_at ASC LIMIT $1`,
      [limit]
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `query pending falló: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const events = pend.rows as Array<{ id: string; agent_id: string | null; conversation_id: string | null; type: string }>;
  let sent = 0,
    failed = 0,
    skipped = 0,
    wouldSend = 0;
  const detail: Array<Record<string, unknown>> = [];

  for (const ev of events) {
    let tokens: string[] = [];
    if (ev.agent_id) {
      const t = await pool.query(
        `SELECT fcm_token FROM "${schema}".agent_device_tokens WHERE agent_id=$1::uuid AND is_active=true`,
        [ev.agent_id]
      );
      tokens = (t.rows as Array<{ fcm_token: string }>).map((r) => r.fcm_token).filter(Boolean);
    }
    if (tokens.length === 0) {
      if (!dryRun) {
        await pool
          .query(
            `UPDATE "${schema}".agent_notification_events SET status='skipped', error_message='no_active_device', updated_at=now() WHERE id=$1::uuid`,
            [ev.id]
          )
          .catch(() => {});
      }
      skipped++;
      detail.push({ event: ev.id.slice(0, 8), result: "skipped_no_device" });
      continue;
    }

    let body = "Tenés un nuevo mensaje";
    if (ev.conversation_id) {
      const c = await pool.query(
        `SELECT c.last_message_preview AS preview, ct.nombre, ct.telefono
           FROM "${schema}".chat_conversations c
           LEFT JOIN "${schema}".chat_contacts ct ON ct.id=c.contact_id
          WHERE c.id=$1::uuid`,
        [ev.conversation_id]
      );
      const row = c.rows[0] as { preview?: string | null; nombre?: string | null; telefono?: string | null } | undefined;
      const who = (row?.nombre || row?.telefono || "").toString().trim();
      const prev = (row?.preview || "").toString().trim();
      body = who ? (prev ? `${who}: ${prev}`.slice(0, 140) : who) : prev ? prev.slice(0, 140) : body;
    }
    const title = TITLES[ev.type] ?? "Notificación";
    const route = ev.conversation_id ? `/m/asesor/chat/${ev.conversation_id}` : "/m/asesor";

    if (dryRun) {
      wouldSend++;
      detail.push({ event: ev.id.slice(0, 8), tokens: tokens.length, would_send: true, title });
      continue;
    }
    if (!fcm.ok) {
      failed++;
      await pool
        .query(
          `UPDATE "${schema}".agent_notification_events SET status='failed', error_message=$2, updated_at=now() WHERE id=$1::uuid`,
          [ev.id, `fcm_${fcm.reason}`]
        )
        .catch(() => {});
      detail.push({ event: ev.id.slice(0, 8), result: "fcm_unavailable" });
      continue;
    }

    try {
      const res = await fcm.messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { conversationId: ev.conversation_id ?? "", route, type: ev.type },
        android: { priority: "high" },
      });
      const toDeactivate: string[] = [];
      res.responses.forEach((r, i) => {
        if (!r.success) {
          const code = (r.error as { code?: string } | undefined)?.code ?? "";
          if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
            toDeactivate.push(tokens[i]);
          }
        }
      });
      if (toDeactivate.length > 0) {
        await pool
          .query(
            `UPDATE "${schema}".agent_device_tokens SET is_active=false, updated_at=now() WHERE empresa_id IS NOT NULL AND fcm_token = ANY($1::text[])`,
            [toDeactivate]
          )
          .catch(() => {});
      }
      if (res.successCount > 0) {
        const msgId = res.responses.find((r) => r.success)?.messageId ?? null;
        await pool.query(
          `UPDATE "${schema}".agent_notification_events SET status='sent', provider_message_id=$2, sent_at=now(), updated_at=now() WHERE id=$1::uuid`,
          [ev.id, msgId]
        );
        sent++;
        detail.push({ event: ev.id.slice(0, 8), result: "sent", ok: res.successCount, fail: res.failureCount });
      } else {
        await pool.query(
          `UPDATE "${schema}".agent_notification_events SET status='failed', error_message=$2, updated_at=now() WHERE id=$1::uuid`,
          [ev.id, `all_failed(${res.failureCount})`]
        );
        failed++;
        detail.push({ event: ev.id.slice(0, 8), result: "failed", fail: res.failureCount });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await pool
        .query(
          `UPDATE "${schema}".agent_notification_events SET status='failed', error_message=$2, updated_at=now() WHERE id=$1::uuid`,
          [ev.id, msg.slice(0, 300)]
        )
        .catch(() => {});
      failed++;
      detail.push({ event: ev.id.slice(0, 8), result: "error" });
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    scanned: events.length,
    sent,
    failed,
    skipped,
    would_send: wouldSend,
    firebase_configured: fcm.ok,
    detail,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
