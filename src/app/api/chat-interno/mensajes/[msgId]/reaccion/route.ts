import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { esMiembro, requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/** Emojis disponibles. Una lista corta se lee de un vistazo; un selector completo no. */
const EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

/**
 * POST — pone o saca una reacción. Es un interruptor: volver a tocar el mismo
 * emoji lo quita, que es lo que espera cualquiera que use un chat.
 */
export async function POST(request: Request, { params }: { params: Promise<{ msgId: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;
  const { msgId } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as { emoji?: string };
    const emoji = String(body.emoji ?? "");
    if (!EMOJIS.includes(emoji)) {
      return NextResponse.json(errorResponse("Emoji no permitido"), { status: 400 });
    }

    const { data: msg } = await sb
      .from("chat_interno_mensajes")
      .select("id, sala_id, reacciones, eliminado_at")
      .eq("id", msgId)
      .maybeSingle();
    const m = msg as
      | { sala_id: string; reacciones: Record<string, string[]> | null; eliminado_at: string | null }
      | null;
    if (!m) return NextResponse.json(errorResponse("Mensaje no encontrado"), { status: 404 });
    if (m.eliminado_at) {
      return NextResponse.json(errorResponse("El mensaje está eliminado"), { status: 400 });
    }

    const { miembro } = await esMiembro(sb, m.sala_id, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });

    const actuales = m.reacciones ?? {};
    const quienes = new Set(actuales[emoji] ?? []);
    if (quienes.has(usuarioId)) quienes.delete(usuarioId);
    else quienes.add(usuarioId);

    const siguiente: Record<string, string[]> = { ...actuales };
    if (quienes.size > 0) siguiente[emoji] = [...quienes];
    else delete siguiente[emoji];

    const { error } = await sb
      .from("chat_interno_mensajes")
      .update({ reacciones: Object.keys(siguiente).length > 0 ? siguiente : null })
      .eq("id", msgId);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ reacciones: siguiente }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
