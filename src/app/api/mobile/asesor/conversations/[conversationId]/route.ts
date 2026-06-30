import { NextRequest, NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export const runtime = "nodejs";

/**
 * GET /api/mobile/asesor/conversations/[conversationId]
 * Detalle + mensajes recientes de UNA conversación, SOLO si está asignada al asesor
 * logueado. Si no es suya → 403 (no puede abrir chats de otro por URL directa).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
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
    const agentIds = new Set((ag.rows as Array<{ id: string }>).map((r) => r.id));

    const cr = await pool.query(
      `SELECT c.id, c.status, c.assigned_agent_id, c.whatsapp_window_expires_at, c.last_message_preview,
              ct.nombre AS contact_nombre, ct.telefono AS contact_telefono
         FROM "${sch}".chat_conversations c
         LEFT JOIN "${sch}".chat_contacts ct ON ct.id = c.contact_id
        WHERE c.id=$1::uuid AND c.empresa_id=$2::uuid`,
      [conversationId, empresa_id]
    );
    const conv = cr.rows[0] as
      | { id: string; status: string; assigned_agent_id: string | null; whatsapp_window_expires_at: string | null; contact_nombre: string | null; contact_telefono: string | null }
      | undefined;
    if (!conv) return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    // Seguridad: solo si está asignada a un agent_id del usuario.
    if (!conv.assigned_agent_id || !agentIds.has(conv.assigned_agent_id)) {
      return NextResponse.json({ ok: false, error: "No autorizado para esta conversación" }, { status: 403 });
    }

    const mr = await pool.query(
      `SELECT id, from_me, sender_type, content, message_type, created_at
         FROM "${sch}".chat_messages
        WHERE conversation_id=$1::uuid AND empresa_id=$2::uuid
        ORDER BY created_at DESC
        LIMIT 80`,
      [conversationId, empresa_id]
    );
    const messages = (mr.rows as Array<Record<string, unknown>>)
      .map((m) => ({
        id: m.id as string,
        from_me: Boolean(m.from_me),
        sender_type: (m.sender_type as string | null) ?? null,
        content: (m.content as string | null) ?? "",
        message_type: (m.message_type as string | null) ?? "text",
        created_at: (m.created_at as string | null) ?? null,
      }))
      .reverse();

    const windowOpen = conv.whatsapp_window_expires_at
      ? new Date(conv.whatsapp_window_expires_at).getTime() > Date.now()
      : null;

    return NextResponse.json({
      ok: true,
      conversation: {
        id: conv.id,
        status: conv.status,
        contact_nombre: conv.contact_nombre,
        contact_telefono: conv.contact_telefono,
        window_open: windowOpen,
        whatsapp_window_expires_at: conv.whatsapp_window_expires_at,
      },
      messages,
    });
  } catch (e) {
    console.error("[mobile/asesor/conversations/:id]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
