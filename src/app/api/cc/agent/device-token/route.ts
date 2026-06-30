import { NextRequest, NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export const runtime = "nodejs";

/**
 * POST /api/cc/agent/device-token
 * Registra/actualiza el token FCM del dispositivo del agente (idempotente).
 * Body: { fcm_token, platform?, app_version?, device_label? }
 *
 * Idempotencia: UNIQUE (empresa_id, fcm_token). Si el token ya existe, actualiza
 * last_seen_at, is_active=true y metadatos; nunca duplica.
 * Escopado al usuario logueado (no se puede registrar token de otro).
 */
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole();
  } catch {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { empresa_id, usuario_id, dataSchema } = ctx;

  const body = (await request.json().catch(() => null)) as
    | { fcm_token?: string; platform?: string; app_version?: string; device_label?: string }
    | null;
  const fcmToken = typeof body?.fcm_token === "string" ? body.fcm_token.trim() : "";
  if (!fcmToken) {
    return NextResponse.json({ ok: false, error: "fcm_token requerido" }, { status: 400 });
  }
  const platformRaw = (body?.platform ?? "android").trim().toLowerCase();
  const platform = ["android", "ios", "web"].includes(platformRaw) ? platformRaw : "android";
  const appVersion =
    typeof body?.app_version === "string" ? body.app_version.trim().slice(0, 40) || null : null;
  const deviceLabel =
    typeof body?.device_label === "string" ? body.device_label.trim().slice(0, 120) || null : null;

  const pool = getChatPostgresPool();
  if (!pool) return NextResponse.json({ ok: false, error: "pool no disponible" }, { status: 500 });
  let sch: string;
  try {
    sch = assertAllowedChatDataSchema(dataSchema);
  } catch {
    return NextResponse.json({ ok: false, error: "schema inválido" }, { status: 500 });
  }

  try {
    const ag = await pool.query(
      `SELECT id FROM "${sch}".chat_agents WHERE empresa_id=$1::uuid AND usuario_id=$2::uuid ORDER BY is_active DESC LIMIT 1`,
      [empresa_id, usuario_id]
    );
    const agentId = (ag.rows[0] as { id?: string } | undefined)?.id ?? null;

    const up = await pool.query(
      `INSERT INTO "${sch}".agent_device_tokens
         (empresa_id, agent_id, user_id, platform, fcm_token, device_name, app_version, is_active, last_seen_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, true, now())
       ON CONFLICT (empresa_id, fcm_token) DO UPDATE SET
         agent_id    = EXCLUDED.agent_id,
         user_id     = EXCLUDED.user_id,
         platform    = EXCLUDED.platform,
         device_name = COALESCE(EXCLUDED.device_name, "${sch}".agent_device_tokens.device_name),
         app_version = COALESCE(EXCLUDED.app_version, "${sch}".agent_device_tokens.app_version),
         is_active   = true,
         last_seen_at = now(),
         updated_at   = now()
       RETURNING id`,
      [empresa_id, agentId, usuario_id, platform, fcmToken, deviceLabel, appVersion]
    );
    const id = (up.rows[0] as { id?: string } | undefined)?.id ?? null;
    return NextResponse.json({ ok: true, id, agent_id: agentId, is_agent: agentId != null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/cc/agent/device-token] error:", msg);
    return NextResponse.json({ ok: false, error: "No se pudo registrar el dispositivo" }, { status: 500 });
  }
}
