import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  ESTADOS_EXIGEN_SUBTAREAS_FINALIZADAS,
  TICKET_CAMPOS,
  eventoDeTransicion,
  mensajeEstadoFinal,
  puedeEstarACargo,
  requiereResponsable,
  slaDe,
  transicionPermitida,
  type TicketFila,
} from "@/lib/soporte/dominio";
import {
  errorInesperado,
  falla,
  leerCatalogos,
  ok,
  personasDeEmpresa,
  registrarHistorial,
  sinPermiso,
  ticketDeEmpresa,
  type EventoHistorial,
} from "@/lib/soporte/servidor";
import { enriquecerTickets } from "@/lib/soporte/tickets-servidor";
import { abrirRevisionQa, subtareasSinFinalizar } from "@/lib/soporte/subtareas";

type Params = { params: Promise<{ id: string }> };

/** GET /api/soporte/tickets/[id] — el ticket con etiquetas, personas y SLA. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    // Todo lo que no depende del ticket sale junto con el ticket.
    const [fila, cat, { count: comentarios }, { count: archivos }, { count: relaciones }] = await Promise.all([
      ticketDeEmpresa<TicketFila>(auth.sb, auth.empresaId, id, TICKET_CAMPOS),
      leerCatalogos(auth.sb, auth.empresaId),
      auth.sb.from("soporte_ticket_comentarios").select("id", { count: "exact", head: true }).eq("empresa_id", auth.empresaId).eq("ticket_id", id).is("subtarea_id", null),
      auth.sb.from("soporte_ticket_archivos").select("id", { count: "exact", head: true }).eq("empresa_id", auth.empresaId).eq("ticket_id", id),
      auth.sb.from("soporte_ticket_relaciones").select("id", { count: "exact", head: true }).eq("empresa_id", auth.empresaId).or(`ticket_id.eq.${id},ticket_relacionado_id.eq.${id}`),
    ]);
    if (!fila) return falla("Ticket no encontrado", 404);

    const [[ticket], proyectoTitulo] = await Promise.all([
      enriquecerTickets(auth.sb, auth.empresaId, cat, [fila]),
      fila.proyecto_id
        ? auth.sb
            .from("proyectos")
            .select("titulo")
            .eq("empresa_id", auth.empresaId)
            .eq("id", fila.proyecto_id)
            .maybeSingle()
            .then(({ data }) => (data as { titulo?: string } | null)?.titulo ?? null)
        : Promise.resolve(null),
    ]);

    return ok({
      ticket: { ...ticket, proyecto_titulo: proyectoTitulo },
      contadores: { comentarios: comentarios ?? 0, archivos: archivos ?? 0, relaciones: relaciones ?? 0 },
    });
  } catch (e) {
    return errorInesperado(e);
  }
}

const TEXTOS = [
  ["asunto", 200],
  ["descripcion", 20_000],
  ["resultado_esperado", 20_000],
  ["impacto_operativo", 20_000],
  ["pasos_reproducir", 20_000],
  ["criterios_aceptacion", 20_000],
  ["modulo", 120],
  ["version", 60],
  ["entorno", 60],
  ["navegador", 120],
] as const;

/**
 * PATCH /api/soporte/tickets/[id] — edita el ticket y deja rastro de cada cambio.
 *
 * Cada campo que cambia genera su propio evento de historial con el valor
 * anterior y el nuevo. El historial se escribe DESPUÉS de que el cambio quedó
 * guardado: un cambio rechazado no deja un evento que nunca ocurrió.
 *
 * Reglas del flujo:
 *   · El cambio de estado respeta las transiciones del flujo (ver `TRANSICIONES`).
 *   · Un estado activo (salvo el inicial) no puede quedar sin responsable.
 *   · No se pasa a Resuelto ni a Cerrado con subtareas sin finalizar.
 *   · Al entrar a "Listo para revisión" se abre la subtarea de revisión de QA.
 *   · Cambiar la clasificación recalcula el SLA, y eso también queda registrado.
 */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);

  try {
    const { id } = await params;
    const actual = await ticketDeEmpresa<TicketFila>(auth.sb, auth.empresaId, id, TICKET_CAMPOS);
    if (!actual) return falla("Ticket no encontrado", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const cat = await leerCatalogos(auth.sb, auth.empresaId);
    const patch: Record<string, unknown> = {};
    const eventos: EventoHistorial[] = [];
    const ahora = new Date().toISOString();

    // ---- textos
    const editados: string[] = [];
    for (const [campo, max] of TEXTOS) {
      if (!(campo in body)) continue;
      const v = typeof body[campo] === "string" ? (body[campo] as string).trim().slice(0, max) : "";
      const nuevo = v || null;
      if ((campo === "asunto" || campo === "descripcion") && !nuevo) {
        return falla(campo === "asunto" ? "El asunto es obligatorio" : "La descripción es obligatoria");
      }
      if (nuevo !== (actual[campo] ?? null)) {
        patch[campo] = nuevo;
        editados.push(campo);
      }
    }
    if (editados.length) eventos.push({ tipo_evento: "edicion", metadata: { campos: editados } });

    // ---- tipo y clasificación (definen el SLA)
    let tipoNuevo = actual.tipo_codigo;
    let clasifNueva = actual.clasificacion_codigo;
    if ("tipo_codigo" in body && body.tipo_codigo !== actual.tipo_codigo) {
      const t = cat.tipos.find((x) => x.activo && x.codigo === body.tipo_codigo);
      if (!t) return falla("Tipo inválido");
      tipoNuevo = t.codigo;
      patch.tipo_codigo = t.codigo;
      eventos.push({ tipo_evento: "cambio_tipo", valor_anterior: actual.tipo_codigo, valor_nuevo: t.codigo });
      clasifNueva = null;
    }
    if ("clasificacion_codigo" in body || patch.tipo_codigo) {
      const deseada = "clasificacion_codigo" in body ? (body.clasificacion_codigo as string | null) : clasifNueva;
      const posibles = cat.clasificaciones.filter((c) => c.activo && c.tipo_codigo === tipoNuevo);
      if (posibles.length > 0) {
        const c = posibles.find((x) => x.codigo === deseada);
        if (!c) return falla("Elegí una clasificación válida para el tipo");
        clasifNueva = c.codigo;
      } else {
        clasifNueva = null;
      }
      if (clasifNueva !== actual.clasificacion_codigo) {
        patch.clasificacion_codigo = clasifNueva;
        eventos.push({ tipo_evento: "cambio_clasificacion", valor_anterior: actual.clasificacion_codigo, valor_nuevo: clasifNueva });
      }
    }
    if (patch.tipo_codigo !== undefined || patch.clasificacion_codigo !== undefined) {
      const sla = slaDe(cat, tipoNuevo, clasifNueva);
      const previo = actual.sla_horas == null ? null : Number(actual.sla_horas);
      if (sla !== previo) {
        patch.sla_horas = sla;
        eventos.push({
          tipo_evento: "cambio_sla",
          valor_anterior: previo == null ? null : String(previo),
          valor_nuevo: sla == null ? null : String(sla),
        });
      }
    }

    // ---- prioridad
    if ("prioridad_codigo" in body && body.prioridad_codigo !== actual.prioridad_codigo) {
      const pr = cat.prioridades.find((x) => x.activo && x.codigo === body.prioridad_codigo);
      if (!pr) return falla("Prioridad inválida");
      patch.prioridad_codigo = pr.codigo;
      eventos.push({ tipo_evento: "cambio_prioridad", valor_anterior: actual.prioridad_codigo, valor_nuevo: pr.codigo });
    }

    // ---- responsable
    let responsableFinal = actual.responsable_id;
    if ("responsable_id" in body) {
      const nuevo = typeof body.responsable_id === "string" && body.responsable_id ? body.responsable_id : null;
      if (nuevo !== actual.responsable_id) {
        if (nuevo) {
          const equipo = await personasDeEmpresa(auth.empresaId);
          if (!equipo.some((u) => u.id === nuevo && puedeEstarACargo(u))) return falla("A cargo sólo pueden quedar Desarrollo o QA");
        }
        patch.responsable_id = nuevo;
        responsableFinal = nuevo;
        eventos.push({ tipo_evento: "cambio_responsable", valor_anterior: actual.responsable_id, valor_nuevo: nuevo });
      }
    }

    // ---- próxima acción
    if ("proxima_accion" in body) {
      const v = typeof body.proxima_accion === "string" ? body.proxima_accion.trim().slice(0, 500) || null : null;
      if (v !== actual.proxima_accion) {
        patch.proxima_accion = v;
        eventos.push({ tipo_evento: "cambio_proxima_accion", valor_anterior: actual.proxima_accion, valor_nuevo: v });
      }
    }

    // ---- fecha objetivo
    if ("fecha_objetivo" in body) {
      const v = typeof body.fecha_objetivo === "string" && body.fecha_objetivo ? body.fecha_objetivo : null;
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return falla("Fecha objetivo inválida");
      if (v !== actual.fecha_objetivo) {
        patch.fecha_objetivo = v;
        eventos.push({ tipo_evento: "cambio_fecha_objetivo", valor_anterior: actual.fecha_objetivo, valor_nuevo: v });
      }
    }

    // ---- estado
    let motivoDevolucion: string | null = null;
    if ("estado_codigo" in body && body.estado_codigo !== actual.estado_codigo) {
      const hacia = cat.estados.find((e) => e.activo && e.codigo === body.estado_codigo);
      if (!hacia) return falla("Estado inválido");
      if (!transicionPermitida(actual.estado_codigo, hacia.codigo)) {
        const desde = cat.estados.find((e) => e.codigo === actual.estado_codigo)?.nombre ?? actual.estado_codigo;
        const final = mensajeEstadoFinal(actual, desde);
        if (final) return falla(final);
        return falla(`No se puede pasar de "${desde}" a "${hacia.nombre}"`);
      }
      if (requiereResponsable(hacia) && !responsableFinal) {
        return falla(`Para pasar a "${hacia.nombre}" el ticket necesita un responsable`);
      }
      if (ESTADOS_EXIGEN_SUBTAREAS_FINALIZADAS.includes(hacia.codigo)) {
        const pendientes = await subtareasSinFinalizar(auth, id);
        if (pendientes.length > 0) {
          return falla(`No se puede pasar a "${hacia.nombre}": hay ${pendientes.length === 1 ? "una subtarea" : `${pendientes.length} subtareas`} sin finalizar (${pendientes.map((x) => x.titulo).join(", ")})`);
        }
      }
      const evento = eventoDeTransicion(actual.estado_codigo, hacia.codigo);
      if (evento === "devolucion_qa") {
        motivoDevolucion = typeof body.comentario === "string" ? body.comentario.trim() : "";
        if (!motivoDevolucion) return falla("Explicá qué observó QA para devolver el ticket");
      }

      patch.estado_codigo = hacia.codigo;
      if (hacia.detiene_sla) {
        if (!actual.resuelto_at) patch.resuelto_at = ahora;
      } else {
        patch.resuelto_at = null;
      }
      patch.cerrado_at = hacia.codigo === "cerrado" || hacia.codigo === "cancelado" ? ahora : null;
      eventos.push({ tipo_evento: evento, valor_anterior: actual.estado_codigo, valor_nuevo: hacia.codigo });
    }

    if (Object.keys(patch).length === 0) return ok({ sin_cambios: true });

    patch.updated_at = ahora;
    patch.updated_by = auth.usuarioId;
    const { error } = await auth.sb.from("soporte_tickets").update(patch).eq("empresa_id", auth.empresaId).eq("id", id);
    if (error) return falla(error.message);

    if (motivoDevolucion) {
      const { data: com } = await auth.sb
        .from("soporte_ticket_comentarios")
        .insert({
          empresa_id: auth.empresaId,
          ticket_id: id,
          usuario_id: auth.usuarioId,
          contenido: motivoDevolucion,
          es_rechazo_qa: true,
        })
        .select("id")
        .single();
      eventos.push({ tipo_evento: "comentario", metadata: { comentario_id: com?.id ?? null, rechazo_qa: true } });
    }

    await registrarHistorial(auth.sb, { empresaId: auth.empresaId, ticketId: id, usuarioId: auth.usuarioId, eventos });
    // Después del historial: la subtarea queda registrada tras la entrega.
    if (patch.estado_codigo === "listo_revision") {
      await abrirRevisionQa(auth, { id, numero: actual.numero, asunto: (patch.asunto as string | undefined) ?? actual.asunto });
    }
    return ok({ actualizado: true, eventos: eventos.map((e) => e.tipo_evento) });
  } catch (e) {
    return errorInesperado(e);
  }
}
