import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireNotificacionesAccess } from "@/lib/notificaciones/notificaciones-auth";
import { avisosEsqueletoDe } from "@/lib/proyectos/esqueleto-avisos";
import { avisosAgendaDe } from "@/lib/agenda/agenda-avisos";

/**
 * GET /api/notificaciones?limit=20&solo_no_leidas=1
 *
 * Panel de la campanita. Devuelve siempre el contador de no leídas junto al
 * listado, para que el header no tenga que hacer dos requests.
 *
 * El destinatario sale de la sesión (`auth.usuarioId`), nunca de la
 * query: si viniera del cliente, cualquiera podría leer las de un compañero
 * pasando otro id.
 */
const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;

export async function GET(request: Request) {
  const auth = await requireNotificacionesAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sp = new URL(request.url).searchParams;
    const limitRaw = Number(sp.get("limit"));
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), LIMIT_MAX)
      : LIMIT_DEFAULT;
    const soloNoLeidas = sp.get("solo_no_leidas") === "1";

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    let listado = sb
      .from("usuario_notificaciones")
      .select("id, tipo, titulo, cuerpo, proyecto_id, observacion_id, agrupadas, leida_at, created_at")
      .eq("empresa_id", auth.empresaId)
      .eq("usuario_id", auth.usuarioId);
    if (soloNoLeidas) listado = listado.is("leida_at", null);

    const [itemsRes, countRes, avisos, avisosCitas] = await Promise.all([
      listado.order("created_at", { ascending: false }).limit(limit),
      sb
        .from("usuario_notificaciones")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", auth.empresaId)
        .eq("usuario_id", auth.usuarioId)
        .is("leida_at", null),
      // Avisos de esqueleto: se calculan en vivo, no salen de la tabla.
      // Ver `esqueleto-avisos.ts` para por qué no se persisten.
      avisosEsqueletoDe(sb, auth.empresaId, auth.usuarioId),
      // Recordatorios de reunión (1 h y 30 min antes). También en vivo: ver
      // `agenda-avisos.ts`.
      avisosAgendaDe(sb, auth.empresaId, auth.usuarioId),
    ]);

    if (itemsRes.error) {
      return NextResponse.json(errorResponse(itemsRes.error.message), { status: 400 });
    }

    // Los avisos derivados van arriba de todo: son los únicos que tienen una
    // fecha comprometida encima. Y suman al contador, que es lo que hace que la
    // campanita se encienda sin que nadie tenga que abrir el tablero.
    return NextResponse.json(
      successResponse({
        // Las reuniones van primero de todo: son lo único con una hora encima
        // que no se puede posponer.
        notificaciones: [...avisosCitas, ...avisos, ...(itemsRes.data ?? [])],
        no_leidas: (countRes.count ?? 0) + avisos.length + avisosCitas.length,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
