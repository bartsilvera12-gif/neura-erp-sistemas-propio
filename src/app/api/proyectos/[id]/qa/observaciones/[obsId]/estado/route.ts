import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  QA_OBSERVACION_SELECT,
  bumpProyectoActividad,
  enriquecerObservaciones,
  esQAEstado,
  fetchObservacion,
  registrarEventoQA,
  type QAObservacionEstado,
  type QAObservacionRow,
} from "@/lib/proyectos/qa-shared";

/**
 * Sellos de auditoría según el estado destino.
 *
 * `resuelto` lo firma quien ejecuta el ajuste; `verificado` es el visto bueno
 * posterior y no pisa el sello de resolución. Volver a `pendiente`/`en_curso`
 * es reabrir: se limpian ambos sellos para que no queden firmas de una
 * resolución que ya no vale. `descartado` no firma nada.
 */
function sellos(
  estado: QAObservacionEstado,
  usuarioId: string | null,
  ahora: string
): Record<string, unknown> {
  switch (estado) {
    case "resuelto":
      return { resuelto_por: usuarioId, resuelto_at: ahora, verificado_por: null, verificado_at: null };
    case "verificado":
      return { verificado_por: usuarioId, verificado_at: ahora };
    case "pendiente":
    case "en_curso":
      return { resuelto_por: null, resuelto_at: null, verificado_por: null, verificado_at: null };
    default:
      return {};
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; obsId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, obsId } = await params;
  const pid = id?.trim() ?? "";
  const oid = obsId?.trim() ?? "";
  if (!pid || !oid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const estado = typeof body?.estado === "string" ? body.estado.trim() : "";
    if (!esQAEstado(estado)) {
      return NextResponse.json(errorResponse("estado inválido"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const prev = await fetchObservacion(sb, auth.empresaId, pid, oid);
    if (!prev) return NextResponse.json(errorResponse("Observación no encontrada"), { status: 404 });

    if (prev.estado === estado) {
      const [sinCambios] = await enriquecerObservaciones(sb, auth.empresaId, [prev]);
      return NextResponse.json(successResponse(sinCambios ?? prev));
    }

    const { data, error } = await sb
      .from("proyecto_qa_observaciones")
      .update({ estado, ...sellos(estado, auth.usuarioCatalogId, new Date().toISOString()) })
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", oid)
      .select(QA_OBSERVACION_SELECT);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_estado_cambiado",
      observacionId: oid,
      payload: { numero: prev.numero, antes: prev.estado, despues: estado },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    const row = (Array.isArray(data) ? data[0] : data) as QAObservacionRow;
    const [enriquecida] = await enriquecerObservaciones(sb, auth.empresaId, [row]);
    return NextResponse.json(successResponse(enriquecida ?? row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
