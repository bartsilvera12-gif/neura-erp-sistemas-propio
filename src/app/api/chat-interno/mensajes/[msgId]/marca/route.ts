import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { esMiembro, requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/** Cuántos mensajes fijados puede tener una sala a la vez (como WhatsApp). */
const MAX_FIJADOS = 3;

/**
 * POST — fijar o destacar un mensaje.
 *
 * Body: `{ tipo: "fijar" | "destacar", valor: boolean }`.
 * - Fijar es de la sala: cualquier miembro lo hace y lo ven todos arriba de la
 *   conversación. Si ya hay tres fijados, el más viejo se suelta solo.
 * - Destacar es personal: queda en la lista de destacados de quien lo marcó.
 */
export async function POST(request: Request, { params }: { params: Promise<{ msgId: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;
  const { msgId } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as { tipo?: string; valor?: boolean };
    const tipo = body.tipo;
    const valor = body.valor === true;
    if (tipo !== "fijar" && tipo !== "destacar") {
      return NextResponse.json(errorResponse("Acción no válida"), { status: 400 });
    }

    const { data: msg } = await sb
      .from("chat_interno_mensajes")
      .select("id, sala_id, eliminado_at, destacado_por")
      .eq("id", msgId)
      .maybeSingle();
    const m = msg as
      | { sala_id: string; eliminado_at: string | null; destacado_por: string[] | null }
      | null;
    if (!m) return NextResponse.json(errorResponse("Mensaje no encontrado"), { status: 404 });
    if (m.eliminado_at && valor) {
      return NextResponse.json(errorResponse("El mensaje está eliminado"), { status: 400 });
    }

    const { miembro } = await esMiembro(sb, m.sala_id, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });

    if (tipo === "destacar") {
      const actuales = new Set(m.destacado_por ?? []);
      if (valor) actuales.add(usuarioId);
      else actuales.delete(usuarioId);
      const { error } = await sb
        .from("chat_interno_mensajes")
        .update({ destacado_por: [...actuales] })
        .eq("id", msgId);
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
      return NextResponse.json(successResponse({ ok: true }));
    }

    if (valor) {
      // Al llegar al tope se suelta el más viejo, para no pedirle a nadie que elija.
      const { data: fijados } = await sb
        .from("chat_interno_mensajes")
        .select("id")
        .eq("sala_id", m.sala_id)
        .not("fijado_at", "is", null)
        .neq("id", msgId)
        .order("fijado_at", { ascending: false });
      const sobran = ((fijados ?? []) as { id: string }[]).slice(MAX_FIJADOS - 1).map((f) => f.id);
      if (sobran.length) {
        await sb
          .from("chat_interno_mensajes")
          .update({ fijado_at: null, fijado_por: null })
          .in("id", sobran);
      }
    }
    const { error } = await sb
      .from("chat_interno_mensajes")
      .update(
        valor
          ? { fijado_at: new Date().toISOString(), fijado_por: usuarioId }
          : { fijado_at: null, fijado_por: null }
      )
      .eq("id", msgId);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
