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
 *
 * Se resuelve con DOS consultas y no con una por sala. Contar sala por sala son
 * N viajes a la base para devolver un solo número, y crece con cada
 * conversación que alguien abre.
 */

/**
 * Hasta dónde se mira hacia atrás.
 *
 * Un mensaje de hace más de un mes que nunca se leyó ya no es un pendiente, es
 * historia; y sin este piso, una sala nunca abierta obligaría a recorrerla
 * entera para calcular un número que igual va a decir "muchos".
 */
const DIAS_ATRAS = 30;
const TOPE_MENSAJES = 1000;

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

    const piso = new Date(Date.now() - DIAS_ATRAS * 86400000).toISOString();
    // El corte de cada sala; el de la consulta es el más viejo de todos, y
    // después se afina en memoria con el de cada una.
    const corteDe = new Map(
      salas.map((s) => {
        const leido = s.ultima_lectura_at ?? "";
        return [s.sala_id, leido > piso ? leido : piso] as const;
      })
    );
    const corteGlobal = [...corteDe.values()].reduce((a, b) => (a < b ? a : b), piso);

    const { data, error } = await sb
      .from("chat_interno_mensajes")
      .select("sala_id, created_at")
      .in("sala_id", salas.map((s) => s.sala_id))
      .is("eliminado_at", null)
      // Lo propio nunca cuenta como no leído.
      .neq("usuario_id", usuarioId)
      .gt("created_at", corteGlobal)
      .order("created_at", { ascending: false })
      .limit(TOPE_MENSAJES);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const porSala: Record<string, number> = {};
    for (const m of (data ?? []) as { sala_id: string; created_at: string }[]) {
      const corte = corteDe.get(m.sala_id);
      if (!corte || m.created_at <= corte) continue;
      porSala[m.sala_id] = (porSala[m.sala_id] ?? 0) + 1;
    }
    const total = Object.values(porSala).reduce((a, b) => a + b, 0);

    return NextResponse.json(
      successResponse({
        total,
        por_sala: porSala,
        // La pestaña las usa para ignorar los avisos de conversaciones ajenas.
        mis_salas: salas.map((x) => x.sala_id),
      })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo contar"),
      { status: 500 }
    );
  }
}
