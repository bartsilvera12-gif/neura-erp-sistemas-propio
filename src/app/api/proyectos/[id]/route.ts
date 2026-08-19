import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { mergeBriefDataPatch } from "@/lib/proyectos/brief-data";
import { listProyectoCambios } from "@/lib/proyectos/cambios-config";
import { enrichProyectosRows } from "@/lib/proyectos/enrich-proyectos";
import { enrichProyectoHistorialRows } from "@/lib/proyectos/historial-enrich";
import { insertHistorialReasignacionTecnico } from "@/lib/proyectos/historial-actions";
import {
  ETAPA_FINAL,
  ETAPA_INICIAL,
  esEtapaDesarrollo,
  type ProyectoEtapaDesarrollo,
} from "@/lib/proyectos/etapas-desarrollo";
import {
  QA_ETAPA_FINAL,
  QA_ETAPA_INICIAL,
  esEtapaQA,
  type ProyectoEtapaQA,
} from "@/lib/proyectos/etapas-qa";
import { esEstadoPausado } from "@/lib/proyectos/estados-tablero";
import { msLaborables } from "@/lib/proyectos/reloj-laboral";
import { computeSlaTotales, type HistorialRow } from "@/lib/proyectos/sla-from-historial";
import { puedeEliminarProyectos, requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { patchAsignacionQa, resolverQaUnica } from "@/lib/proyectos/qa-asignacion";
import { PROYECTOS_BUCKET } from "@/lib/proyectos/proyectos-archivos-storage";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

const PRIORIDADES = new Set(["baja", "normal", "alta", "urgente"]);

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
    const empresaId = auth.empresaId;

    const { data: proyecto, error: e1 } = await sb
      .from("proyectos")
      .select("*")
      .eq("empresa_id", empresaId)
      .eq("id", pid)
      .maybeSingle();

    if (e1) return NextResponse.json(errorResponse(e1.message), { status: 400 });
    if (!proyecto) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const [enrichedArr, hist, tareas, comentarios, archivos, cambios] = await Promise.all([
      enrichProyectosRows(sb, empresaId, [proyecto as Record<string, unknown>]),
      sb
        .from("proyecto_estado_historial")
        .select(
          "id, estado_anterior_id, estado_nuevo_id, changed_by, changed_at, entered_at, exited_at, duration_seconds, tipo_sla_snapshot, metadata"
        )
        .eq("empresa_id", empresaId)
        .eq("proyecto_id", pid)
        .order("entered_at", { ascending: true }),
      sb
        .from("proyecto_tareas")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("proyecto_id", pid)
        .order("sort_order", { ascending: true }),
      sb
        .from("proyecto_comentarios")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("proyecto_id", pid)
        .order("created_at", { ascending: false }),
      sb
        .from("proyecto_archivos")
        .select("id, nombre, mime_type, size_bytes, uploaded_by, created_at")
        .eq("empresa_id", empresaId)
        .eq("proyecto_id", pid)
        .order("created_at", { ascending: false }),
      listProyectoCambios(sb, empresaId, pid).catch(() => []),
    ]);

    const histRows = (hist.data ?? []) as HistorialRow[];
    const sla = computeSlaTotales(histRows);
    const historialEnriched = await enrichProyectoHistorialRows(sb, empresaId, hist.data ?? []);

    const comRows = (comentarios.data ?? []) as { usuario_id: string }[];
    const tareaRows = (tareas.data ?? []) as Array<{
      created_by?: string | null;
      status_changed_by?: string | null;
      responsable_id?: string | null;
    }>;
    const archivoRows = (archivos.data ?? []) as Array<{ uploaded_by?: string | null }>;
    const uids = [
      ...new Set([
        ...comRows.map((c) => c.usuario_id),
        ...tareaRows.map((t) => t.created_by ?? ""),
        ...tareaRows.map((t) => t.status_changed_by ?? ""),
        ...tareaRows.map((t) => t.responsable_id ?? ""),
        ...archivoRows.map((a) => a.uploaded_by ?? ""),
      ].filter((u): u is string => Boolean(u))),
    ];
    const catalog = createServiceRoleClient();
    const { data: names } =
      uids.length > 0
        ? await catalog.from("usuarios").select("id, nombre").eq("empresa_id", empresaId).in("id", uids)
        : { data: [] as { id: string; nombre?: string }[] };
    const nameMap = new Map((names ?? []).map((u) => [u.id, u.nombre ?? ""]));

    const comentariosRich = comRows.map((c) => ({
      ...c,
      usuario_nombre: nameMap.get(c.usuario_id) ?? null,
    }));

    const tareasRich = tareaRows.map((t) => ({
      ...t,
      created_by_nombre: t.created_by ? nameMap.get(t.created_by) ?? null : null,
      status_changed_by_nombre: t.status_changed_by
        ? nameMap.get(t.status_changed_by) ?? null
        : null,
      responsable_nombre: t.responsable_id ? nameMap.get(t.responsable_id) ?? null : null,
    }));

    const archivosRich = (archivos.data ?? []).map((a) => {
      const row = a as Record<string, unknown>;
      const uploadedBy = typeof row.uploaded_by === "string" ? row.uploaded_by : null;
      return {
        ...row,
        uploaded_by_nombre: uploadedBy ? nameMap.get(uploadedBy) ?? null : null,
      };
    });

    const base = enrichedArr[0] ?? (proyecto as Record<string, unknown>);
    const avance =
      (tareas.data ?? []).length === 0
        ? null
        : Math.round(
            ((tareas.data ?? []).filter((t: { estado?: string }) => t.estado === "completada").length /
              (tareas.data ?? []).length) *
              100
          );

    return NextResponse.json(
      successResponse({
        proyecto: base,
        historial: historialEnriched,
        sla,
        tareas: tareasRich,
        comentarios: comentariosRich,
        archivos: archivosRich,
        cambios,
        avance_pct: avance,
        current_user_id: auth.usuarioCatalogId,
        current_user_rol: auth.rol ?? null,
        current_user_puede_eliminar: puedeEliminarProyectos(auth),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }

    if ("estado_id" in body) {
      return NextResponse.json(errorResponse("Usá POST /api/proyectos/[id]/cambiar-estado para mover estado"), {
        status: 400,
      });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const patch: Record<string, unknown> = {
      updated_by: auth.usuarioCatalogId,
      last_activity_at: new Date().toISOString(),
    };
    // Reasignación de responsable técnico a registrar en el historial (tras el update OK).
    let reasignacionTecnico: { de: string | null; a: string | null } | null = null;

    if (typeof body.titulo === "string") patch.titulo = body.titulo.trim();
    if (typeof body.descripcion === "string") patch.descripcion = body.descripcion;
    if (typeof body.prioridad === "string" && PRIORIDADES.has(body.prioridad)) patch.prioridad = body.prioridad;
    if ("cliente_id" in body)
      patch.cliente_id =
        typeof body.cliente_id === "string" && body.cliente_id ? body.cliente_id : null;
    if ("tipo_id" in body && typeof body.tipo_id === "string") patch.tipo_id = body.tipo_id;
    if ("responsable_comercial_id" in body) {
      patch.responsable_comercial_id =
        typeof body.responsable_comercial_id === "string" && body.responsable_comercial_id
          ? body.responsable_comercial_id
          : null;
    }
    if ("responsable_tecnico_id" in body) {
      patch.responsable_tecnico_id =
        typeof body.responsable_tecnico_id === "string" && body.responsable_tecnico_id
          ? body.responsable_tecnico_id
          : null;
    }
    if (typeof body.fecha_prometida === "string" || body.fecha_prometida === null) {
      patch.fecha_prometida =
        typeof body.fecha_prometida === "string" && body.fecha_prometida.trim()
          ? body.fecha_prometida
          : null;
    }
    if (typeof body.fecha_entrega === "string" || body.fecha_entrega === null) {
      patch.fecha_entrega =
        typeof body.fecha_entrega === "string" && body.fecha_entrega.trim()
          ? body.fecha_entrega
          : null;
    }
    if ("monto_vendido" in body) {
      patch.monto_vendido =
        body.monto_vendido === null || body.monto_vendido === ""
          ? null
          : Number(body.monto_vendido);
    }
    if (typeof body.observaciones_comerciales === "string" || body.observaciones_comerciales === null) {
      patch.observaciones_comerciales =
        typeof body.observaciones_comerciales === "string" ? body.observaciones_comerciales : null;
    }
    if (body.brief_data && typeof body.brief_data === "object" && !Array.isArray(body.brief_data)) {
      const { data: curBrief, error: eBrief } = await sb
        .from("proyectos")
        .select("brief_data")
        .eq("empresa_id", auth.empresaId)
        .eq("id", pid)
        .maybeSingle();
      if (eBrief) return NextResponse.json(errorResponse(eBrief.message), { status: 400 });
      const existing = (curBrief as { brief_data?: unknown } | null)?.brief_data;
      patch.brief_data = mergeBriefDataPatch(
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {},
        body.brief_data as Record<string, unknown>
      );
    }
    if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      patch.metadata = body.metadata;
    }
    if (typeof body.bloqueado === "boolean") patch.bloqueado = body.bloqueado;
    if (typeof body.bloqueo_motivo === "string" || body.bloqueo_motivo === null) {
      patch.bloqueo_motivo =
        typeof body.bloqueo_motivo === "string" && body.bloqueo_motivo.trim()
          ? body.bloqueo_motivo
          : null;
    }
    if (typeof body.archivado === "boolean") patch.archivado = body.archivado;

    // --- Etapa de desarrollo + contador de días por programador --------------
    // Ambos campos necesitan comparar contra el valor actual: la etapa para saber
    // si hay que resellar los timestamps, y el técnico para reiniciar el contador
    // sólo cuando el proyecto realmente cambia de manos.
    const pideEtapa = "etapa_desarrollo" in body;
    const pideTecnico = "responsable_tecnico_id" in body;
    const pideQaResponsable = "qa_responsable_id" in body;
    const pideQaEtapa = "qa_etapa" in body;
    const pidePausa = "pausado" in body;
    // Editar sólo el texto del motivo también entra al bloque de abajo: si no,
    // un body con únicamente `pausa_motivo` no encontraba dónde aplicarse y la
    // request terminaba en "Nada para actualizar".
    const pideMotivo = "pausa_motivo" in body;

    if (pideEtapa && !esEtapaDesarrollo(body.etapa_desarrollo)) {
      return NextResponse.json(errorResponse("Etapa de desarrollo inválida"), { status: 400 });
    }
    if (pideQaEtapa && body.qa_etapa !== null && !esEtapaQA(body.qa_etapa)) {
      return NextResponse.json(errorResponse("Etapa de QA inválida"), { status: 400 });
    }
    if (pidePausa && typeof body.pausado !== "boolean") {
      return NextResponse.json(errorResponse("`pausado` debe ser booleano"), { status: 400 });
    }

    if (pideEtapa || pideTecnico || pideQaResponsable || pideQaEtapa || pidePausa || pideMotivo) {
      const { data: actual, error: eActual } = await sb
        .from("proyectos")
        .select(
          "etapa_desarrollo, responsable_tecnico_id, qa_responsable_id, qa_etapa, pausado_at, pausa_acumulada_ms, estado_id, ultimo_movimiento_at"
        )
        .eq("empresa_id", auth.empresaId)
        .eq("id", pid)
        .maybeSingle();
      if (eActual) return NextResponse.json(errorResponse(eActual.message), { status: 400 });
      if (!actual) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

      const cur = actual as {
        etapa_desarrollo?: string | null;
        responsable_tecnico_id?: string | null;
        qa_responsable_id?: string | null;
        qa_etapa?: string | null;
        estado_id?: string | null;
        ultimo_movimiento_at?: string | null;
        pausado_at?: string | null;
        pausa_acumulada_ms?: number | null;
      };
      const ahora = new Date().toISOString();

      if (pideEtapa) {
        const nueva = body.etapa_desarrollo as ProyectoEtapaDesarrollo;
        patch.etapa_desarrollo = nueva;
        if (nueva !== (cur.etapa_desarrollo ?? ETAPA_INICIAL)) {
          patch.etapa_desarrollo_at = ahora;
          // Volver atrás desde "Finalizado" limpia la marca y el proyecto
          // reaparece en el listado activo del tablero del equipo.
          patch.etapa_finalizado_at = nueva === ETAPA_FINAL ? ahora : null;

          // Pasar la etapa a "QA" es, en la práctica, mandárselo a la persona
          // de QA: se la asigna sola para no obligar a un segundo paso que es
          // fácil de olvidar (y sin el cual el proyecto no aparece en su
          // tarjeta del tablero). Sólo automático cuando hay una sola QA en la
          // empresa; con varias no hay forma de adivinar cuál, y se elige a
          // mano desde el selector de responsable.
          if (nueva === "qa" && !cur.qa_responsable_id && !pideQaResponsable) {
            const qaId = await resolverQaUnica(auth.empresaId);
            if (qaId) Object.assign(patch, patchAsignacionQa(qaId, ahora));
          }
        }
      }

      if (pideTecnico && patch.responsable_tecnico_id !== (cur.responsable_tecnico_id ?? null)) {
        patch.tecnico_asignado_at = patch.responsable_tecnico_id ? ahora : null;
        reasignacionTecnico = {
          de: cur.responsable_tecnico_id ?? null,
          a: (patch.responsable_tecnico_id as string | null) ?? null,
        };
      }

      // --- QA: responsable + etapa propia ------------------------------------
      // Asignar QA arranca la etapa inicial y el contador; quitarlo limpia todo
      // el eje para que el proyecto desaparezca del bloque de QA del tablero.
      if (pideQaResponsable) {
        const nuevoQa =
          typeof body.qa_responsable_id === "string" && body.qa_responsable_id
            ? body.qa_responsable_id
            : null;
        patch.qa_responsable_id = nuevoQa;
        if (nuevoQa !== (cur.qa_responsable_id ?? null)) {
          patch.qa_asignado_at = nuevoQa ? ahora : null;
          if (nuevoQa) {
            // Arranca un ciclo de revisión nuevo si no había etapa o si la
            // anterior estaba cerrada; si no, el proyecto quedaría asignado
            // pero invisible en el bloque de QA del tablero.
            const cerrada = !cur.qa_etapa || cur.qa_etapa === QA_ETAPA_FINAL;
            if (!pideQaEtapa && cerrada) {
              patch.qa_etapa = QA_ETAPA_INICIAL;
              patch.qa_etapa_at = ahora;
            }
          } else {
            patch.qa_etapa = null;
            patch.qa_etapa_at = null;
          }
        }
      }

      if (pideQaEtapa) {
        const nuevaQa = body.qa_etapa === null ? null : (body.qa_etapa as ProyectoEtapaQA);
        patch.qa_etapa = nuevaQa;
        if (nuevaQa !== (cur.qa_etapa ?? null)) patch.qa_etapa_at = nuevaQa ? ahora : null;
      }

      // --- Pausa -------------------------------------------------------------
      // No es una etapa: al despausar el proyecto vuelve a la etapa donde
      // estaba. Al cerrar una pausa se acumula su duración para que el contador
      // de días del tablero descuente el tiempo detenido.
      if (pidePausa) {
        const quierePausado = body.pausado === true;
        const motivo =
          typeof body.pausa_motivo === "string" && body.pausa_motivo.trim()
            ? body.pausa_motivo.trim()
            : null;
        const estabaPausado = typeof cur.pausado_at === "string" && !!cur.pausado_at;

        if (quierePausado) {
          if (!motivo) {
            return NextResponse.json(
              errorResponse("Indicá el motivo de la pausa"),
              { status: 400 }
            );
          }
          patch.pausa_motivo = motivo;
          // Repausar algo ya pausado sólo corrige el motivo: si resellamos
          // `pausado_at` perdemos el tiempo detenido que va acumulándose.
          if (!estabaPausado) patch.pausado_at = ahora;
        } else {
          if (estabaPausado) {
            const previo = Number(cur.pausa_acumulada_ms ?? 0);
            const base = Number.isFinite(previo) && previo > 0 ? previo : 0;
            // Milisegundos LABORALES, misma unidad que el contador del tablero.
            // Ver `msTrabajados` en la ruta de tareas-equipo.
            patch.pausa_acumulada_ms = base + (msLaborables(cur.pausado_at as string, ahora) ?? 0);
          }
          patch.pausado_at = null;
          patch.pausa_motivo = null;
        }
      } else if (typeof body.pausa_motivo === "string") {
        // Editar sólo el texto del motivo, sin tocar el reloj de una pausa ya abierta.
        if (typeof cur.pausado_at === "string" && cur.pausado_at) {
          patch.pausa_motivo = body.pausa_motivo.trim() || null;
        } else {
          // Puede estar en la columna "Pausado" del Kanban sin pausa abierta:
          // pasa con los proyectos que se movieron antes de que el cambio de
          // estado gobernara la pausa. Sin esto el motivo se perdía en silencio.
          // Se abre la pausa retroactivamente desde que entró a la columna, que
          // es el instante correcto y no "ahora".
          const { data: est } = cur.estado_id
            ? await sb
                .from("proyecto_estados")
                .select("tipo_sla")
                .eq("empresa_id", auth.empresaId)
                .eq("id", cur.estado_id)
                .maybeSingle()
            : { data: null };

          if (esEstadoPausado(est as { tipo_sla: string | null } | null)) {
            patch.pausa_motivo = body.pausa_motivo.trim() || null;
            patch.pausado_at = cur.ultimo_movimiento_at ?? ahora;
          } else {
            return NextResponse.json(
              errorResponse("El proyecto no está pausado: movelo a la columna Pausado primero"),
              { status: 400 }
            );
          }
        }
      }
    }

    // Corrección manual del inicio del contador de días. Va después del bloque
    // de arriba a propósito: si en el mismo PATCH se reasigna el proyecto y se
    // fija una fecha, gana la fecha explícita que puso el usuario.
    if ("tecnico_asignado_at" in body) {
      const raw = body.tecnico_asignado_at;
      if (raw === null || raw === "") {
        patch.tecnico_asignado_at = null;
      } else if (typeof raw === "string" && Number.isFinite(Date.parse(raw))) {
        patch.tecnico_asignado_at = new Date(raw).toISOString();
      } else {
        return NextResponse.json(errorResponse("Fecha de asignación inválida"), { status: 400 });
      }
    }

    const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
    if (keys.length <= 2) {
      return NextResponse.json(errorResponse("Nada para actualizar"), { status: 400 });
    }

    const { data: updated, error } = await sb
      .from("proyectos")
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .select("*");

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const row = Array.isArray(updated) ? updated[0] : updated;
    if (!row) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    // Reasignación de técnico → queda en el historial. No bloqueante: el update ya
    // se aplicó, un fallo del registro no debe voltear la operación.
    if (reasignacionTecnico && reasignacionTecnico.de !== reasignacionTecnico.a) {
      try {
        await insertHistorialReasignacionTecnico({
          sb,
          empresaId: auth.empresaId,
          proyectoId: pid,
          deTecnicoId: reasignacionTecnico.de,
          aTecnicoId: reasignacionTecnico.a,
          changedBy: auth.usuarioCatalogId,
        });
      } catch (e) {
        console.error("[proyectos] no se pudo registrar la reasignación de técnico en historial", e);
      }
    }

    const enriched = await enrichProyectosRows(sb, auth.empresaId, [row as Record<string, unknown>]);
    return NextResponse.json(successResponse(enriched[0] ?? row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

type StorageCapableClient = {
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
        opts: { limit: number; offset: number }
      ) => Promise<{ data: { name: string }[] | null; error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Borra todos los archivos del proyecto en el bucket (adjuntos del proyecto y de los ítems de QA),
 * que viven bajo el prefijo `${empresaId}/${proyectoId}/`.
 */
async function removeProyectoStorageFiles(
  sb: StorageCapableClient,
  empresaId: string,
  proyectoId: string
): Promise<void> {
  const bucket = sb.storage.from(PROYECTOS_BUCKET);
  const prefix = `${empresaId}/${proyectoId}`;
  const PAGE = 100;
  const MAX_PAGES = 200; // corta un loop infinito si el bucket devolviera siempre lo mismo

  // Cada pasada borra la página que acaba de listar, así que la siguiente vuelve a pedir desde 0.
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset: 0 });
    if (error) throw new Error(error.message);
    const names = (data ?? []).map((f) => f.name).filter((n) => n.length > 0);
    if (names.length === 0) return;

    const { error: eRemove } = await bucket.remove(names.map((n) => `${prefix}/${n}`));
    if (eRemove) throw new Error(eRemove.message);
  }
}

/** Eliminación definitiva (HARD DELETE). Cascade borra tareas/comentarios/archivos/historial.
 *  Restringido a admin y super_admin. Para los demás roles existe PATCH { archivado: true } (soft delete). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  if (!puedeEliminarProyectos(auth)) {
    return NextResponse.json(
      errorResponse("Solo administradores pueden eliminar proyectos definitivamente. Podés archivarlo en su lugar."),
      { status: 403 }
    );
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) {
    return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data: existing, error: eFind } = await sb
      .from("proyectos")
      .select("id, titulo")
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .maybeSingle();
    if (eFind) return NextResponse.json(errorResponse(eFind.message), { status: 400 });
    if (!existing) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    // Los binarios del bucket no cuelgan del cascade de la BD: hay que borrarlos aparte
    // o quedan huérfanos. Best-effort: si falla, igual eliminamos el proyecto.
    await removeProyectoStorageFiles(sb, auth.empresaId, pid).catch(() => {});

    const { error: eDel } = await sb
      .from("proyectos")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);
    if (eDel) return NextResponse.json(errorResponse(eDel.message), { status: 400 });

    return NextResponse.json(
      successResponse({ id: pid, titulo: (existing as { titulo?: string }).titulo ?? null, eliminado: true })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
