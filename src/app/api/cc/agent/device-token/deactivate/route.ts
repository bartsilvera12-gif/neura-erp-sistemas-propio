import { NextRequest, NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export const runtime = "nodejs";

/**
 * POST /api/cc/agent/device-token/deactivate
 * Desactiva (is_active=false) el token FCM indicado, escopado al usuario logueado.
 * Se usa al cerrar sesión / logout en la app. No borra la fila (auditoría).
 * Body: { fcm_token }
 */
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole();
  } catch {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { empresa_id, usuario_id, dataSchema } = ctx;

  const body = (await request.json().catch(() => null)) as { fcm_token?: string } | null;
  const fcmToken = typeof body?.fcm_token === "string" ? body.fcm_token.trim() : "";
  if (!fcmToken) return NextResponse.json({ ok: false, error: "fcm_token requerido" }, { status: 400 });

  const pool = getChatPostgresPool();
  if (!pool) return NextResponse.json({ ok: false, error: "pool no disponible" }, { status: 500 });
  let sch: string;
  try {
    sch = assertAllowedChatDataSchema(dataSchema);
  } catch {
    return NextResponse.json({ ok: false, error: "schema inválido" }, { status: 500 });
  }

  try {
    const r = await pool.query(
      `UPDATE "${sch}".agent_device_tokens SET is_active=false, updated_at=now()
       WHERE empresa_id=$1::uuid AND user_id=$2::uuid AND fcm_token=$3 RETURNING id`,
      [empresa_id, usuario_id, fcmToken]
    );
    return NextResponse.json({ ok: true, deactivated: r.rowCount ?? 0 });
  } catch (e) {
    console.error("[api/cc/agent/device-token/deactivate]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
