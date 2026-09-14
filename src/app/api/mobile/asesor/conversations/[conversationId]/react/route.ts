import { NextRequest, NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";

export const runtime = "nodejs";

/**
 * POST /api/mobile/asesor/conversations/[conversationId]/react
 * Body JSON: { target_wa_message_id, emoji }. Mismo patrón que send / send-media del móvil:
 *  1) verifica que la conversación esté asignada a un chat_agent del asesor logueado;
 *  2) delega en /api/chat/react, reenviando la auth del request.
 *
 * `emoji: ""` es válido: así se RETIRA una reacción puesta antes.
 */
export async function POST(
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

  const body = (await request.json().catch(() => null)) as { target_wa_message_id?: string; emoji?: string } | null;
  const target = typeof body?.target_wa_message_id === "string" ? body.target_wa_message_id.trim() : "";
  const emoji = typeof body?.emoji === "string" ? body.emoji.trim() : "";
  if (!target) {
    return NextResponse.json({ ok: false, error: "Se requiere target_wa_message_id" }, { status: 400 });
  }

  try {
    const { data: agRows } = await supabase
      .from("chat_agents")
      .select("id")
      .eq("empresa_id", empresa_id)
      .eq("usuario_id", usuario_id);
    const agentIds = new Set((agRows ?? []).map((r) => String((r as { id: string }).id)));

    const { data: conv } = await supabase
      .from("chat_conversations")
      .select("assigned_agent_id")
      .eq("id", conversationId)
      .eq("empresa_id", empresa_id)
      .maybeSingle();

    if (!conv) return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    const assignedAgentId = (conv as { assigned_agent_id: string | null }).assigned_agent_id;
    if (!assignedAgentId || !agentIds.has(String(assignedAgentId))) {
      return NextResponse.json(
        { ok: false, error: "No autorizado para esta conversación", code: "forbidden" },
        { status: 403 }
      );
    }
  } catch (e) {
    console.error("[mobile react] ownership check", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const auth = request.headers.get("authorization");
    const cookie = request.headers.get("cookie");
    if (auth) headers.authorization = auth;
    if (cookie) headers.cookie = cookie;

    const res = await fetch(new URL("/api/chat/react", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ conversation_id: conversationId, target_wa_message_id: target, emoji }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "react_failed" }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[mobile react] forward", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "No se pudo reaccionar" }, { status: 502 });
  }
}
