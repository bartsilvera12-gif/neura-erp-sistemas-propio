import { NextRequest, NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";

export const runtime = "nodejs";

/**
 * POST /api/mobile/asesor/conversations/[conversationId]/send-sticker
 * Body JSON: { sticker_url }. Mismo patrón que send / send-media del móvil:
 *  1) verifica que la conversación esté asignada a un chat_agent del asesor logueado;
 *  2) delega en /api/chat/send-sticker, reenviando la auth del request.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Iniciá sesión", code: "unauthenticated" },
      { status: 401 }
    );
  }
  const { supabase, empresa_id, usuario_id } = ctx;

  const body = (await request.json().catch(() => null)) as { sticker_url?: string } | null;
  const stickerUrl = typeof body?.sticker_url === "string" ? body.sticker_url.trim() : "";
  if (!stickerUrl) {
    return NextResponse.json({ ok: false, error: "Se requiere sticker_url" }, { status: 400 });
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
    console.error("[mobile send-sticker] ownership check", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const auth = request.headers.get("authorization");
    const cookie = request.headers.get("cookie");
    if (auth) headers.authorization = auth;
    if (cookie) headers.cookie = cookie;

    const res = await fetch(new URL("/api/chat/send-sticker", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ conversation_id: conversationId, sticker_url: stickerUrl }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "send_sticker_failed" }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[mobile send-sticker] forward", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "No se pudo enviar el sticker" }, { status: 502 });
  }
}
