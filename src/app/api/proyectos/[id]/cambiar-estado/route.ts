import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { enrichProyectosRows } from "@/lib/proyectos/enrich-proyectos";
import { cerrarSegmentoHistorialAbierto, insertHistorialCambioEstado } from "@/lib/proyectos/historial-actions";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { patchAsignacionQa, resolverQaUnica } from "@/lib/proyectos/qa-asignacion";
import { notificarEntradaQA } from "@/lib/proyectos/qa-notificaciones";
import { esEstadoPausado, etapaDesdeEstado } from "@/lib/proyectos/estados-tablero";
import { notificarCambioEstado } from "@/lib/proyectos/estado-notificaciones";
import { msLaborables } from "@/lib/proyectos/reloj-laboral";

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
      .select(
        "id, titulo, estado_id, responsable_tecnico_id, responsable_comercial_id, qa_responsable_id, etapa_desarrollo, pausado_at, pausa_acumulada_ms"
      )
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
      .select("id, codigo, nombre, tipo_sla, es_estado_final")
      .eq("empresa_id", empresaId)
      .eq("id", nuevoEstadoId)
      .eq("activo", true)
      .maybeSingle();

    if (e2 || !estNuevo) {
      return NextResponse.json(errorResponse("Estado destino no válido"), { status: 400 });
    }

    const est = estNuevo as {
      codigo?: string | null;
      nombre?: string | null;
      tipo_sla?: string | null;
      es_estado_final?: boolean | null;
    };
    const tipoSla = String(est.tipo_sla ?? "interno");
    const codigoNuevo = String(est.codigo ?? "").trim().toLowerCase();

    await cerrarSegmentoHistorialAbierto(sb, empresaId, pid);

    const now = new Date().toISOString();
    const cur = proyecto as {
      etapa_desarrollo?: string | null;
      pausado_at?: string | null;
      pausa_acumulada_ms?: number | null;
    };

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

    // --- Pausa gobernada por el estado ---------------------------------------
    // "Pausado" es una columna del Kanban como cualquier otra, pero además es lo
    // que congela el contador del tablero. Mover el proyecto a esa columna abre
    // la pausa, y sacarlo de ahí la cierra acumulando el tiempo detenido — el
    // mismo mecanismo que ya usaba el botón de pausa del tablero.
    const estabaPausado = typeof cur.pausado_at === "string" && !!cur.pausado_at;
    const quedaPausado = esEstadoPausado({ tipo_sla: tipoSla });

    if (quedaPausado && !estabaPausado) {
      update.pausado_at = now;
    } else if (!quedaPausado && estabaPausado) {
      const previo = Number(cur.pausa_acumulada_ms ?? 0);
      const base = Number.isFinite(previo) && previo > 0 ? previo : 0;
      // Se acumula la porción LABORAL de la pausa, no el calendario: es la
      // unidad en la que el tablero mide el contador, y así una pausa que cae
      // entera en fin de semana no descuenta trabajo que nunca existió.
      update.pausa_acumulada_ms = base + (msLaborables(cur.pausado_at as string, now) ?? 0);
      update.pausado_at = null;
      update.pausa_motivo = null;
    }

    // --- Proyección sobre el eje técnico -------------------------------------
    // Ver `etapaDesdeEstado`: la etapa ya no se edita a mano, se deriva, para
    // que los reportes que la leen sigan vivos.
    const etapaDerivada = etapaDesdeEstado(est.codigo ?? null);
    if (etapaDerivada && etapaDerivada !== (cur.etapa_desarrollo ?? null)) {
      update.etapa_desarrollo = etapaDerivada;
      update.etapa_desarrollo_at = now;
      // Volver atrás desde "finalizado" limpia la marca: el proyecto reaparece
      // como activo y deja de contar en el reporte de entregados del mes.
      update.etapa_finalizado_at = etapaDerivada === "finalizado" ? now : null;
    }

    const { error: e3 } = await sb
      .from("proyectos")
      .update(update)
      .eq("empresa_id", empresaId)
      .eq("id", pid);

    if (e3) return NextResponse.json(errorResponse(e3.message), { status: 400 });

    // Aviso al comercial del proyecto. Va después del update por la misma razón
    // que el de QA: si falla, el movimiento ya está guardado y no se revierte.
    {
      const comercialId =
        (proyecto as { responsable_comercial_id?: string | null }).responsable_comercial_id ?? null;
      // El nombre del estado anterior se lee acá y no antes: sólo hace falta
      // para el texto del aviso, y evita una consulta cuando no hay a quién avisar.
      let estadoAnteriorNombre: string | null = null;
      if (comercialId && comercialId !== auth.usuarioCatalogId && anteriorId) {
        const { data: estAnt } = await sb
          .from("proyecto_estados")
          .select("nombre")
          .eq("empresa_id", empresaId)
          .eq("id", anteriorId)
          .maybeSingle();
        estadoAnteriorNombre = (estAnt as { nombre?: string | null } | null)?.nombre ?? null;
      }

      await notificarCambioEstado(sb, {
        empresaId,
        proyectoId: pid,
        tituloProyecto,
        comercialId,
        actorId: auth.usuarioCatalogId,
        estadoAnteriorNombre,
        estadoNuevoNombre: (est.nombre ?? "").trim() || codigoNuevo || "otro estado",
        // "Entregado" sale de la configuración de la empresa, no de un código
        // fijo: es el estado que la empresa marcó como final.
        esFinal: est.es_estado_final === true,
      });
    }

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
