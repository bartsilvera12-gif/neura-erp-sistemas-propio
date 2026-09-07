import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { esMiembro, requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/** PATCH — editar el texto. Sólo el autor, y sólo si no está borrado. */
export async function PATCH(request: Request, { params }: { params: Promise<{ msgId: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;
  const { msgId } = await params;

  try {
    const { data: msg } = await sb
      .from("chat_interno_mensajes")
      .select("id, sala_id, usuario_id, eliminado_at, adjuntos")
      .eq("id", msgId)
      .maybeSingle();
    const m = msg as
      | { sala_id: string; usuario_id: string | null; eliminado_at: string | null; adjuntos: unknown }
      | null;
    if (!m) return NextResponse.json(errorResponse("Mensaje no encontrado"), { status: 404 });

    const { miembro } = await esMiembro(sb, m.sala_id, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });
    // Editar lo ajeno cambiaría lo que otro dijo: eso no lo puede hacer nadie,
    // ni siquiera un administrador del grupo.
    if (m.usuario_id !== usuarioId) {
      return NextResponse.json(errorResponse("Sólo podés editar tus mensajes"), { status: 403 });
    }
    if (m.eliminado_at) {
      return NextResponse.json(errorResponse("El mensaje está eliminado"), { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { texto?: string };
    const texto = (body.texto ?? "").trim();
    const tieneAdjuntos = Array.isArray(m.adjuntos) && (m.adjuntos as unknown[]).length > 0;
    if (!texto && !tieneAdjuntos) {
      return NextResponse.json(errorResponse("El mensaje no puede quedar vacío"), { status: 400 });
    }

    const { error } = await sb
      .from("chat_interno_mensajes")
      .update({ texto: texto || null, editado_at: new Date().toISOString() })
      .eq("id", msgId);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

/**
 * DELETE — borrado LÓGICO.
 *
 * Queda el hueco con "Mensaje eliminado" en vez de desaparecer sin rastro: en
 * una conversación de equipo, un mensaje que se esfuma deja a los demás sin
 * entender de qué se estaba hablando.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ msgId: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;
  const { msgId } = await params;

  try {
    const { data: msg } = await sb
      .from("chat_interno_mensajes")
      .select("id, sala_id, usuario_id")
      .eq("id", msgId)
      .maybeSingle();
    const m = msg as { sala_id: string; usuario_id: string | null } | null;
    if (!m) return NextResponse.json(errorResponse("Mensaje no encontrado"), { status: 404 });

    const { miembro, rol } = await esMiembro(sb, m.sala_id, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });
    // El autor borra lo suyo; el administrador del grupo puede moderar.
    if (m.usuario_id !== usuarioId && rol !== "admin") {
      return NextResponse.json(errorResponse("No podés borrar este mensaje"), { status: 403 });
    }

    const { error } = await sb
      .from("chat_interno_mensajes")
      .update({ eliminado_at: new Date().toISOString() })
      .eq("id", msgId);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
