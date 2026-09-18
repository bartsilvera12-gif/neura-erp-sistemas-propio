import { NextRequest, NextResponse } from "next/server";
import { despacharNotificacionesPendientes } from "@/lib/cc/dispatch-notifications";

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
 * Acceso a datos vía cliente service-role PostgREST scopeado al schema de la app
 * (APP_DB_SCHEMA = neura) — NO el pool PG crudo (que no es el camino soportado para neura).
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

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = parseBool(url.searchParams.get("dryRun"));
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const r = await despacharNotificacionesPendientes({ dryRun, limit });
  return NextResponse.json(r.body, { status: r.status });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
