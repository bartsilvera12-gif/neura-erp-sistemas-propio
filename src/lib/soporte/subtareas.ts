import "server-only";
import type { SoporteContexto } from "@/lib/soporte/soporte-auth";
import { subtareaAbierta } from "@/lib/soporte/dominio";
import { personasDeEmpresa, registrarHistorial } from "@/lib/soporte/servidor";

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

/**
 * Al pasar a "Listo para revisión": deja lista la revisión de QA y le avisa.
 *
 *   · Si hay una revisión que pidió cambios, vuelve a Pendiente: es la misma
 *     revisión, con su conversación, esperando que QA confirme la corrección.
 *   · Si hay una pendiente o en proceso, se usa esa.
 *   · Si no hay ninguna abierta, se crea "Revisión QA #N".
 *
 * Se asigna sola a la persona de QA de la empresa (hoy hay una sola; si hubiera
 * varias, la primera por nombre).
 */
export async function abrirRevisionQa(
  auth: SoporteContexto,
  ticket: { id: string; numero: number; asunto: string }
): Promise<SubtareaFila | null> {
  const abiertas = await subtareasSinFinalizar(auth, ticket.id);
  const enCurso = abiertas.find((s) => s.estado === "pendiente" || s.estado === "en_proceso");
  if (enCurso) return enCurso;

  const devuelta = abiertas.find((s) => s.estado === "cambios_solicitados");
  if (devuelta) {
    const { data: reabierta } = await auth.sb
      .from("soporte_subtareas")
      .update({ estado: "pendiente", updated_at: new Date().toISOString(), finalizado_at: null })
      .eq("empresa_id", auth.empresaId)
      .eq("id", devuelta.id)
      .eq("estado", "cambios_solicitados")
      .select(SUBTAREA_CAMPOS)
      .maybeSingle();
    const sub = (reabierta as SubtareaFila | null) ?? devuelta;
    await registrarHistorial(auth.sb, {
      empresaId: auth.empresaId,
      ticketId: ticket.id,
      usuarioId: auth.usuarioId,
      eventos: [
        { tipo_evento: "subtarea_estado", valor_anterior: "cambios_solicitados", valor_nuevo: "pendiente", metadata: { subtarea_id: sub.id, titulo: sub.titulo, reentrega: true } },
      ],
    });
    await avisarSoporte(auth, {
      usuarioId: sub.asignado_id,
      titulo: `Ticket #${ticket.numero} corregido, listo para revisar de nuevo`,
      cuerpo: ticket.asunto,
      ticketId: ticket.id,
      subtareaId: sub.id,
    });
    return sub;
  }

  const [{ data: ultimas }, equipo] = await Promise.all([
    auth.sb
      .from("soporte_subtareas")
      .select("numero")
      .eq("empresa_id", auth.empresaId)
      .eq("ticket_id", ticket.id)
      .order("numero", { ascending: false })
      .limit(1),
    personasDeEmpresa(auth.empresaId),
  ]);
  const numero = (((ultimas ?? []) as { numero: number }[])[0]?.numero ?? 0) + 1;
  const qa = equipo.find((p) => p.es_qa) ?? null;

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
    eventos: [{ tipo_evento: "subtarea_creada", valor_nuevo: sub.titulo, metadata: { subtarea_id: sub.id, asignado_id: sub.asignado_id } }],
  });
  await avisarSoporte(auth, {
    usuarioId: sub.asignado_id,
    titulo: `Ticket #${ticket.numero} listo para revisión`,
    cuerpo: ticket.asunto,
    ticketId: ticket.id,
    subtareaId: sub.id,
  });
  return sub;
}
