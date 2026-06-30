import { NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export const runtime = "nodejs";

/**
 * GET /api/mobile/asesor/conversations
 * Lista ESTRICTAMENTE las conversaciones open/pending asignadas al asesor logueado
 * (assigned_agent_id ∈ sus chat_agents). Seguridad en backend: nunca devuelve chats
 * de otros, ni sin-asignar, ni de otra cola. Si el usuario no es agente → lista vacía.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole();
  } catch {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const { empresa_id, usuario_id, dataSchema } = ctx;
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
      `SELECT id FROM "${sch}".chat_agents WHERE empresa_id=$1::uuid AND usuario_id=$2::uuid`,
      [empresa_id, usuario_id]
    );
    const agentIds = (ag.rows as Array<{ id: string }>).map((r) => r.id);
    if (agentIds.length === 0) {
      return NextResponse.json({ ok: true, is_agent: false, conversations: [] });
    }
    const r = await pool.query(
      `SELECT c.id, c.status, c.last_message_at, c.last_message_preview, c.unread_count,
              c.whatsapp_window_expires_at, ct.nombre AS contact_nombre, ct.telefono AS contact_telefono
         FROM "${sch}".chat_conversations c
         LEFT JOIN "${sch}".chat_contacts ct ON ct.id = c.contact_id
        WHERE c.empresa_id=$1::uuid AND c.assigned_agent_id = ANY($2::uuid[]) AND c.status IN ('open','pending')
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT 50`,
      [empresa_id, agentIds]
    );
    const now = Date.now();
    const conversations = (r.rows as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      status: row.status as string,
      last_message_at: (row.last_message_at as string | null) ?? null,
      last_message_preview: (row.last_message_preview as string | null) ?? null,
      unread_count: Number(row.unread_count ?? 0),
      contact_nombre: (row.contact_nombre as string | null) ?? null,
      contact_telefono: (row.contact_telefono as string | null) ?? null,
      window_open: row.whatsapp_window_expires_at
        ? new Date(String(row.whatsapp_window_expires_at)).getTime() > now
        : null,
    }));
    return NextResponse.json({ ok: true, is_agent: true, conversations });
  } catch (e) {
    console.error("[mobile/asesor/conversations]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
