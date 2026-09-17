import { NextRequest, NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { cargarConversacionMovil, detalleConversacionMovil } from "@/lib/chat/mobile-conversation-detail";

export const runtime = "nodejs";

/**
 * GET /api/mobile/asesor/conversations/[conversationId]
 * Detalle + mensajes recientes de UNA conversación, SOLO si está asignada al asesor
 * logueado. Si no es suya → 403 (no puede abrir chats de otro por URL directa).
 *
 * Usa el cliente PostgREST scopeado al schema del tenant (igual que /api/chat/mobile-inbox),
 * que es el camino soportado para neura. (Antes usaba el pool PG crudo → "Error interno".)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole(request);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Iniciá sesión", code: "unauthenticated" },
      { status: 401 }
    );
  }
  const { supabase, empresa_id, usuario_id } = ctx;

  try {
    // Agentes (chat_agents.id) del usuario logueado.
    const { data: agRows } = await supabase
      .from("chat_agents")
      .select("id")
      .eq("empresa_id", empresa_id)
      .eq("usuario_id", usuario_id);
    const agentIds = new Set((agRows ?? []).map((r) => String((r as { id: string }).id)));

    const conv = await cargarConversacionMovil(supabase, empresa_id, conversationId);

    if (!conv) {
      return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    }
    const assignedAgentId = (conv as { assigned_agent_id: string | null }).assigned_agent_id;
    // Seguridad: solo si está asignada a un agent_id del usuario.
    if (!assignedAgentId || !agentIds.has(String(assignedAgentId))) {
      return NextResponse.json(
        { ok: false, error: "No autorizado para esta conversación", code: "forbidden" },
        { status: 403 }
      );
    }

    return NextResponse.json(await detalleConversacionMovil(supabase, empresa_id, conversationId, conv));
  } catch (e) {
    console.error("[mobile/asesor/conversations/:id]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
