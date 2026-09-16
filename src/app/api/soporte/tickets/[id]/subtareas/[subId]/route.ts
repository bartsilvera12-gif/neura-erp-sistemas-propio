import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  ESTADOS_SUBTAREA,
  TRANSICIONES_SUBTAREA,
  nombreEstadoSubtarea,
  type EstadoSubtarea,
} from "@/lib/soporte/dominio";
import { errorInesperado, falla, ok, registrarHistorial, sinPermiso, ticketDeEmpresa, type EventoHistorial } from "@/lib/soporte/servidor";
import { SUBTAREA_CAMPOS, avisarSoporte, type SubtareaFila } from "@/lib/soporte/subtareas";

type Params = { params: Promise<{ id: string; subId: string }> };

const UUID = /^[0-9a-f-]{36}$/i;

type TicketMin = { id: string; numero: number; asunto: string; estado_codigo: string; responsable_id: string | null };

/**
 * PATCH — cambia el estado de una subtarea de revisión.
 *
 *   · "Cambios solicitados" exige un comentario, y si el ticket está en
 *     "Listo para revisión" lo devuelve a "Re-abierto" (y avisa al responsable).
 *   · "Finalizado" avisa al responsable: ya puede pasar el ticket a Resuelto.
 *
 * El cambio se aplica sólo si la subtarea sigue en el estado que se leyó: dos
 * personas no pueden cerrar la misma revisión de dos formas distintas.
 */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id, subId } = await params;
    if (!UUID.test(id) || !UUID.test(subId)) return falla("Subtarea no encontrada", 404);

    const [ticket, { data: subData }] = await Promise.all([
      ticketDeEmpresa<TicketMin>(auth.sb, auth.empresaId, id, "id, numero, asunto, estado_codigo, responsable_id"),
      auth.sb.from("soporte_subtareas").select(SUBTAREA_CAMPOS).eq("empresa_id", auth.empresaId).eq("ticket_id", id).eq("id", subId).maybeSingle(),
    ]);
    const sub = subData as SubtareaFila | null;
    if (!ticket || !sub) return falla("Subtarea no encontrada", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const hacia = ESTADOS_SUBTAREA.find((e) => e.codigo === body?.estado)?.codigo;
    if (!hacia) return falla("Estado inválido");
    const desde = sub.estado as EstadoSubtarea;
    if (hacia === desde) return ok({ sin_cambios: true });
    if (!(TRANSICIONES_SUBTAREA[desde] ?? []).includes(hacia)) {
      return falla(`No se puede pasar de "${nombreEstadoSubtarea(desde)}" a "${nombreEstadoSubtarea(hacia)}"`);
    }
    const comentario = typeof body?.comentario === "string" ? body.comentario.trim().slice(0, 20_000) : "";
    if (hacia === "cambios_solicitados" && !comentario) return falla("Explicá qué cambios hacen falta");

    const ahora = new Date().toISOString();
    const { data: actualizada, error } = await auth.sb
      .from("soporte_subtareas")
      .update({ estado: hacia, updated_at: ahora, finalizado_at: hacia === "finalizado" ? ahora : null })
      .eq("empresa_id", auth.empresaId)
      .eq("id", subId)
      .eq("estado", desde)
      .select("id")
      .maybeSingle();
    if (error) return falla(error.message);
    if (!actualizada) return falla("La subtarea cambió mientras tanto. Recargá y volvé a intentar.", 409);

    const eventos: EventoHistorial[] = [
      { tipo_evento: "subtarea_estado", valor_anterior: desde, valor_nuevo: hacia, metadata: { subtarea_id: sub.id, titulo: sub.titulo } },
    ];

    if (comentario) {
      const { data: com } = await auth.sb
        .from("soporte_ticket_comentarios")
        .insert({
          empresa_id: auth.empresaId,
          ticket_id: id,
          subtarea_id: subId,
          usuario_id: auth.usuarioId,
          contenido: comentario,
          es_rechazo_qa: hacia === "cambios_solicitados",
        })
        .select("id")
        .single();
      eventos.push({ tipo_evento: "comentario", metadata: { comentario_id: com?.id ?? null, subtarea_id: sub.id, rechazo_qa: hacia === "cambios_solicitados" } });
    }

    // QA pidió cambios: el ticket vuelve a Desarrollo.
    let ticketReabierto = false;
    if (hacia === "cambios_solicitados" && ticket.estado_codigo === "listo_revision") {
      const { data: t } = await auth.sb
        .from("soporte_tickets")
        .update({ estado_codigo: "reabierto", resuelto_at: null, cerrado_at: null, updated_at: ahora, updated_by: auth.usuarioId })
        .eq("empresa_id", auth.empresaId)
        .eq("id", id)
        .eq("estado_codigo", "listo_revision")
        .select("id")
        .maybeSingle();
      if (t) {
        ticketReabierto = true;
        eventos.push({ tipo_evento: "devolucion_qa", valor_anterior: "listo_revision", valor_nuevo: "reabierto", metadata: { subtarea_id: sub.id } });
      }
    } else {
      await auth.sb.from("soporte_tickets").update({ updated_at: ahora, updated_by: auth.usuarioId }).eq("empresa_id", auth.empresaId).eq("id", id);
    }

    await registrarHistorial(auth.sb, { empresaId: auth.empresaId, ticketId: id, usuarioId: auth.usuarioId, eventos });

    if (hacia === "cambios_solicitados") {
      await avisarSoporte(auth, {
        usuarioId: ticket.responsable_id,
        titulo: `QA pidió cambios en el ticket #${ticket.numero}`,
        cuerpo: comentario,
        ticketId: id,
        subtareaId: sub.id,
      });
    } else if (hacia === "finalizado") {
      await avisarSoporte(auth, {
        usuarioId: ticket.responsable_id,
        titulo: `QA finalizó la revisión del ticket #${ticket.numero}`,
        cuerpo: ticket.asunto,
        ticketId: id,
        subtareaId: sub.id,
      });
    }

    return ok({ actualizado: true, ticket_reabierto: ticketReabierto });
  } catch (e) {
    return errorInesperado(e);
  }
}
