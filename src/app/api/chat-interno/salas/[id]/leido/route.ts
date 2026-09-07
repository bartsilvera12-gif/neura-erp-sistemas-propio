import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { esMiembro, requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/** POST — marca la sala como leída hasta ahora, para el usuario de la sesión. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });
    await sb
      .from("chat_interno_miembros")
      .update({ ultima_lectura_at: new Date().toISOString() })
      .eq("sala_id", salaId)
      .eq("usuario_id", usuarioId);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error"),
      { status: 500 }
    );
  }
}
