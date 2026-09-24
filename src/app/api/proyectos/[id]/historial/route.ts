import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { enrichProyectoHistorialRows, type HistorialRowRaw } from "@/lib/proyectos/historial-enrich";

/**
 * Historial de estados de UN proyecto, liviano: sólo la línea de tiempo
 * enriquecida (sin comentarios, tareas, SLA ni el resto del detalle). Lo usa el
 * desplegable compacto del tablero, que sólo necesita la secuencia de estados.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) {
    return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("proyecto_estado_historial")
      .select(
        "id, estado_anterior_id, estado_nuevo_id, changed_by, changed_at, entered_at, exited_at, duration_seconds, tipo_sla_snapshot, metadata"
      )
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .order("entered_at", { ascending: true });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    const historial = await enrichProyectoHistorialRows(
      sb,
      auth.empresaId,
      (data ?? []) as HistorialRowRaw[]
    );
    return NextResponse.json(successResponse(historial));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
