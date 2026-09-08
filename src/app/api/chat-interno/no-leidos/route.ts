import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/**
 * Cuántos mensajes sin leer tengo, sumando todas mis salas.
 *
 * Existe aparte de `/salas` porque lo consulta la pestaña del navegador en cada
 * pantalla del ERP, no sólo dentro del chat: traer la bandeja entera —con
 * vistas previas, nombres y avatares firmados— para mostrar un número sería
 * pagar todo eso en cada página.
 */

/** Techo por sala: arriba de esto el número deja de importar, dice "muchos". */
const TOPE_POR_SALA = 200;

export async function GET(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;

  try {
    const { data: mis } = await sb
      .from("chat_interno_miembros")
      .select("sala_id, ultima_lectura_at")
      .eq("usuario_id", usuarioId);

    const salas = (mis ?? []) as { sala_id: string; ultima_lectura_at: string | null }[];
    if (salas.length === 0) {
      return NextResponse.json(successResponse({ total: 0, por_sala: {} }));
    }

    // Una consulta por sala y no una sola con OR: cada sala tiene su propia
    // fecha de lectura, y un OR de N pares fecha/sala arma una URL que el
    // gateway rechaza apenas hay unas pocas conversaciones.
    const conteos = await Promise.all(
      salas.map(async (s) => {
        let q = sb
          .from("chat_interno_mensajes")
          .select("id", { count: "exact", head: true })
          .eq("sala_id", s.sala_id)
          .is("eliminado_at", null)
          // Lo propio nunca cuenta como no leído.
          .neq("usuario_id", usuarioId)
          .limit(TOPE_POR_SALA);
        if (s.ultima_lectura_at) q = q.gt("created_at", s.ultima_lectura_at);
        const { count } = await q;
        return [s.sala_id, count ?? 0] as const;
      })
    );

    const porSala = Object.fromEntries(conteos.filter(([, n]) => n > 0));
    const total = conteos.reduce((acc, [, n]) => acc + n, 0);

    return NextResponse.json(successResponse({ total, por_sala: porSala }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo contar"),
      { status: 500 }
    );
  }
}
