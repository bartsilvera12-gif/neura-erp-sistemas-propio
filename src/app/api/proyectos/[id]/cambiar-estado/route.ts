import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { enrichProyectosRows } from "@/lib/proyectos/enrich-proyectos";
import { cerrarSegmentoHistorialAbierto, insertHistorialCambioEstado } from "@/lib/proyectos/historial-actions";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { patchAsignacionQa, resolverQaUnica } from "@/lib/proyectos/qa-asignacion";
import { notificarEntradaQA } from "@/lib/proyectos/qa-notificaciones";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const body = (await request.json().catch(() => null)) as { estado_id?: string } | null;
    const nuevoEstadoId = typeof body?.estado_id === "string" ? body.estado_id.trim() : "";
    if (!nuevoEstadoId) {
      return NextResponse.json(errorResponse("estado_id obligatorio"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;

    const { data: proyecto, error: e1 } = await sb
      .from("proyectos")
      .select("id, titulo, estado_id, responsable_tecnico_id, qa_responsable_id")
      .eq("empresa_id", empresaId)
      .eq("id", pid)
      .maybeSingle();

    if (e1) return NextResponse.json(errorResponse(e1.message), { status: 400 });
    if (!proyecto) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const anteriorId = (proyecto as { estado_id?: string }).estado_id ?? null;
    const tecnicoSnapshot =
      (proyecto as { responsable_tecnico_id?: string | null }).responsable_tecnico_id ?? null;
    const qaResponsableActual =
      (proyecto as { qa_responsable_id?: string | null }).qa_responsable_id ?? null;
    const tituloProyecto = String((proyecto as { titulo?: string }).titulo ?? "").trim() || "un proyecto";
    if (anteriorId === nuevoEstadoId) {
      const { data: full } = await sb
        .from("proyectos")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("id", pid)
        .maybeSingle();
      if (!full) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });
      const enriched = await enrichProyectosRows(sb, empresaId, [full as Record<string, unknown>]);
      return NextResponse.json(successResponse(enriched[0]));
    }

    const { data: estNuevo, error: e2 } = await sb
      .from("proyecto_estados")
      .select("id, codigo, tipo_sla")
      .eq("empresa_id", empresaId)
      .eq("id", nuevoEstadoId)
      .eq("activo", true)
      .maybeSingle();

    if (e2 || !estNuevo) {
      return NextResponse.json(errorResponse("Estado destino no válido"), { status: 400 });
    }

    const tipoSla = String((estNuevo as { tipo_sla?: string }).tipo_sla ?? "interno");
    const codigoNuevo = String((estNuevo as { codigo?: string }).codigo ?? "").trim().toLowerCase();

    await cerrarSegmentoHistorialAbierto(sb, empresaId, pid);

    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      estado_id: nuevoEstadoId,
      ultimo_movimiento_at: now,
      last_activity_at: now,
      updated_by: auth.usuarioCatalogId,
    };

    // Al entrar al estado QA del tablero, se lo mandamos a la persona de QA: se
    // le asigna sola (si hay una sola en la empresa y el proyecto no tenía QA
    // asignado), arranca su etapa de revisión y el contador. Así la tarjeta le
    // aparece también en su bloque de "Tareas del equipo" sin un paso extra.
    let qaAsignadoId: string | null = null;
    if (codigoNuevo === "qa" && !qaResponsableActual) {
      qaAsignadoId = await resolverQaUnica(empresaId);
      if (qaAsignadoId) Object.assign(update, patchAsignacionQa(qaAsignadoId, now));
    }

    const { error: e3 } = await sb
      .from("proyectos")
      .update(update)
      .eq("empresa_id", empresaId)
      .eq("id", pid);

    if (e3) return NextResponse.json(errorResponse(e3.message), { status: 400 });

    // Aviso a la QA (no bloqueante: si falla, el cambio de estado ya quedó hecho).
    if (qaAsignadoId) {
      await notificarEntradaQA(sb, {
        empresaId,
        proyectoId: pid,
        qaUsuarioId: qaAsignadoId,
        tituloProyecto,
        actorId: auth.usuarioCatalogId,
      });
    }

    await insertHistorialCambioEstado({
      sb,
      empresaId,
      proyectoId: pid,
      estadoAnteriorId: anteriorId,
      estadoNuevoId: nuevoEstadoId,
      tipoSlaSnapshot: tipoSla,
      changedBy: auth.usuarioCatalogId,
      responsableTecnicoId: tecnicoSnapshot,
    });

    const { data: row } = await sb.from("proyectos").select("*").eq("empresa_id", empresaId).eq("id", pid);
    const first = Array.isArray(row) ? row[0] : row;
    if (!first) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const enriched = await enrichProyectosRows(sb, empresaId, [first as Record<string, unknown>]);
    return NextResponse.json(successResponse(enriched[0]));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
