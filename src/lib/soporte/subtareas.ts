import "server-only";
import type { SoporteContexto } from "@/lib/soporte/soporte-auth";
import { subtareaAbierta } from "@/lib/soporte/dominio";
import { personasDeEmpresa, registrarHistorial } from "@/lib/soporte/servidor";
import { numeroTicket } from "@/lib/soporte/dominio";

export type SubtareaFila = {
  id: string;
  ticket_id: string;
  numero: number;
  tipo: string;
  titulo: string;
  estado: string;
  asignado_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finalizado_at: string | null;
};

export const SUBTAREA_CAMPOS = "id, ticket_id, numero, tipo, titulo, estado, asignado_id, created_by, created_at, updated_at, finalizado_at";

/** Subtareas del ticket que todavía no terminaron (pendiente o en proceso). */
export async function subtareasSinFinalizar(auth: SoporteContexto, ticketId: string): Promise<SubtareaFila[]> {
  const { data } = await auth.sb
    .from("soporte_subtareas")
    .select(SUBTAREA_CAMPOS)
    .eq("empresa_id", auth.empresaId)
    .eq("ticket_id", ticketId);
  return ((data ?? []) as SubtareaFila[]).filter((s) => subtareaAbierta(s.estado));
}

/**
 * Aviso en la campanita. Nunca lanza: perder un aviso no puede voltear el
 * cambio que ya quedó guardado.
 */
export async function avisarSoporte(
  auth: SoporteContexto,
  args: { usuarioId: string | null; titulo: string; cuerpo: string; ticketId: string; subtareaId?: string | null }
): Promise<void> {
  if (!args.usuarioId || args.usuarioId === auth.usuarioId) return;
  try {
    const { error } = await auth.sb.from("usuario_notificaciones").insert({
      empresa_id: auth.empresaId,
      usuario_id: args.usuarioId,
      tipo: "soporte_revision",
      titulo: args.titulo.slice(0, 200),
      cuerpo: args.cuerpo.slice(0, 300),
      actor_id: auth.usuarioId,
      metadata: { ticket_id: args.ticketId, subtarea_id: args.subtareaId ?? null },
    });
    if (error) console.error("[soporte] no se pudo avisar", error.message);
  } catch (e) {
    console.error("[soporte] no se pudo avisar", e);
  }
}

/** Estados del ticket que le tocan a las PM: son ellas las que hablan con el cliente. */
const TITULO_PARA_PM: Record<string, (n: number) => string> = {
  resuelto: (n) => `Ticket ${numeroTicket(n)} resuelto`,
  falta_informacion: (n) => `Ticket ${numeroTicket(n)} necesita información del cliente`,
};

/**
 * Avisa a las PM que un ticket llegó a un estado que depende de ellas: Resuelto
 * (hay que avisarle al cliente) o Falta información (hay que ir a pedirla). Les
 * llega estén donde estén: la campanita vive en el encabezado de todo el
 * sistema. Nunca lanza: ver `avisarSoporte`.
 */
export async function avisarEstadoAPMs(
  auth: SoporteContexto,
  ticket: { id: string; numero: number; asunto: string; cliente_nombre?: string | null },
  estadoCodigo: string
): Promise<void> {
  const titulo = TITULO_PARA_PM[estadoCodigo];
  if (!titulo) return;
  const equipo = await personasDeEmpresa(auth.empresaId);
  const cuerpo = ticket.cliente_nombre ? `${ticket.cliente_nombre} · ${ticket.asunto}` : ticket.asunto;
  for (const pm of equipo.filter((p) => p.es_project_manager)) {
    await avisarSoporte(auth, { usuarioId: pm.id, titulo: titulo(ticket.numero), cuerpo, ticketId: ticket.id });
  }
}

/**
 * Al pasar a "Listo para revisión": deja lista la revisión de QA y le avisa.
 *
 *   · Si hay una pendiente o en proceso, se usa esa.
 *   · Si no, se crea "Revisión QA #N". Cada entrega es una ronda: la que pidió
 *     cambios queda cerrada como "Cambios solicitados" y la nueva va a la misma
 *     persona de QA que la devolvió.
 *
 * La primera revisión se asigna a la persona de QA de la empresa (hoy hay una
 * sola; si hubiera varias, la primera por nombre).
 */
export async function abrirRevisionQa(
  auth: SoporteContexto,
  ticket: { id: string; numero: number; asunto: string }
): Promise<SubtareaFila | null> {
  const [{ data: previas }, equipo] = await Promise.all([
    auth.sb
      .from("soporte_subtareas")
      .select(SUBTAREA_CAMPOS)
      .eq("empresa_id", auth.empresaId)
      .eq("ticket_id", ticket.id)
      .order("numero", { ascending: false }),
    personasDeEmpresa(auth.empresaId),
  ]);
  const todas = (previas ?? []) as SubtareaFila[];
  const enCurso = todas.find((s) => subtareaAbierta(s.estado));
  if (enCurso) return enCurso;

  const numero = (todas[0]?.numero ?? 0) + 1;
  const devuelta = todas.find((s) => s.estado === "cambios_solicitados") ?? null;
  const qaDevolvio = devuelta?.asignado_id ? equipo.find((p) => p.id === devuelta.asignado_id && p.es_qa) : null;
  const qa = qaDevolvio ?? equipo.find((p) => p.es_qa) ?? null;

  const { data, error } = await auth.sb
    .from("soporte_subtareas")
    .insert({
      empresa_id: auth.empresaId,
      ticket_id: ticket.id,
      numero,
      tipo: "revision_qa",
      titulo: `Revisión QA #${numero}`,
      estado: "pendiente",
      asignado_id: qa?.id ?? null,
      created_by: auth.usuarioId,
    })
    .select(SUBTAREA_CAMPOS)
    .single();
  if (error || !data) {
    console.error("[soporte] no se pudo abrir la revisión", error?.message);
    return null;
  }
  const sub = data as SubtareaFila;

  await registrarHistorial(auth.sb, {
    empresaId: auth.empresaId,
    ticketId: ticket.id,
    usuarioId: auth.usuarioId,
    eventos: [{ tipo_evento: "subtarea_creada", valor_nuevo: sub.titulo, metadata: { subtarea_id: sub.id, asignado_id: sub.asignado_id, reentrega: !!devuelta } }],
  });
  await avisarSoporte(auth, {
    usuarioId: sub.asignado_id,
    titulo: devuelta
      ? `Ticket ${numeroTicket(ticket.numero)} corregido, listo para revisar de nuevo`
      : `Ticket ${numeroTicket(ticket.numero)} listo para revisión`,
    cuerpo: ticket.asunto,
    ticketId: ticket.id,
    subtareaId: sub.id,
  });
  return sub;
}
