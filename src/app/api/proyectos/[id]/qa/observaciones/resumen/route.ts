import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { QA_ESTADOS_CERRADOS, type QAObservacionEstado } from "@/lib/proyectos/qa-shared";

/**
 * Conteos de QA para la pestaña Resumen y el badge de la solapa. Es una ruta
 * aparte del listado a propósito: trae solo la columna `estado`, sin adjuntos
 * ni signed URLs, porque se pide en cada apertura del detalle de proyecto.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data, error } = await sb
      .from("proyecto_qa_observaciones")
      .select("estado")
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const rows = (data ?? []) as Array<{ estado: QAObservacionEstado }>;
    const porEstado: Record<string, number> = {};
    for (const r of rows) porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;

    const total = rows.length;
    const cerradas = rows.filter((r) => QA_ESTADOS_CERRADOS.includes(r.estado)).length;
    const abiertas = total - cerradas;

    return NextResponse.json(
      successResponse({
        total,
        abiertas,
        cerradas,
        por_estado: porEstado,
        // Avance sobre lo que efectivamente se cerró (resueltas + verificadas +
        // descartadas): sin observaciones cargadas no hay nada que avanzar.
        porcentaje: total === 0 ? 0 : Math.round((cerradas / total) * 100),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
