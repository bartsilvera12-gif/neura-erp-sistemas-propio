import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { fechaObjetivoAIso } from "@/lib/soporte/dominio";
import { buscarConflictoHorario, mensajeConflicto } from "@/lib/agenda/solapes";
import { guardarResponsables } from "@/lib/agenda/responsables";
import { rangoEnHorarioLaboral } from "@/lib/proyectos/reloj-laboral";

export const HORARIO_CAPACITACION =
  "La capacitación tiene que entrar en horario laboral: lunes a viernes de 8 a 17 y sábados de 8 a 12.";

/** Tipo de cita en Agenda para las capacitaciones que salen de una tipificación. */
export const TIPO_CITA_CAPACITACION = "capacitacion";

export type AgendaCapacitacion = {
  inicioIso: string;
  finIso: string;
  responsableId: string;
  ubicacion: string | null;
};

/**
 * Lee y valida la agenda que manda el formulario de tipificación.
 * `inicio` llega como `YYYY-MM-DDTHH:mm` (hora de Paraguay).
 */
export function leerAgendaCapacitacion(
  v: unknown,
  equipo: { id: string }[]
): { ok: true; agenda: AgendaCapacitacion } | { ok: false; mensaje: string } {
  if (!v || typeof v !== "object") return { ok: false, mensaje: "Completá la fecha de la capacitación" };
  const a = v as Record<string, unknown>;
  const inicioIso = typeof a.inicio === "string" ? fechaObjetivoAIso(a.inicio) : undefined;
  if (!inicioIso) return { ok: false, mensaje: "Elegí fecha y hora de la capacitación" };
  const duracion = Number(a.duracion_min);
  if (!Number.isFinite(duracion) || duracion < 15 || duracion > 8 * 60) return { ok: false, mensaje: "Duración inválida" };
  const responsableId = typeof a.responsable_id === "string" ? a.responsable_id : "";
  if (!equipo.some((p) => p.id === responsableId)) return { ok: false, mensaje: "Elegí quién da la capacitación" };
  const ubicacion = typeof a.ubicacion === "string" && a.ubicacion.trim() ? a.ubicacion.trim().slice(0, 500) : null;
  const finIso = new Date(Date.parse(inicioIso) + duracion * 60_000).toISOString();
  if (!rangoEnHorarioLaboral(Date.parse(inicioIso), Date.parse(finIso))) {
    return { ok: false, mensaje: HORARIO_CAPACITACION };
  }
  return { ok: true, agenda: { inicioIso, finIso, responsableId, ubicacion } };
}

/**
 * Agenda la capacitación en `agenda_citas`, vinculada al cliente. Respeta la
 * regla de Agenda: el responsable no puede tener otra cita activa en ese horario.
 * Aparece en Agenda con sus recordatorios (60 y 30 min antes) como cualquier cita.
 */
export async function agendarCapacitacion(
  sb: AppSupabaseClient,
  args: {
    empresaId: string;
    clienteId: string;
    clienteNombre: string;
    agenda: AgendaCapacitacion;
    observaciones: string;
    creadoPor: string | null;
  }
): Promise<{ ok: true; id: string } | { ok: false; mensaje: string; status: number }> {
  const conflicto = await buscarConflictoHorario({
    sb,
    empresaId: args.empresaId,
    responsableId: args.agenda.responsableId,
    inicioIso: args.agenda.inicioIso,
    finIso: args.agenda.finIso,
  }).catch((e: Error) => {
    throw new Error(/agenda_citas/.test(e.message) ? "Esta empresa no tiene el módulo Agenda" : e.message);
  });
  if (conflicto) return { ok: false, mensaje: mensajeConflicto(conflicto), status: 409 };

  const { data, error } = await sb
    .from("agenda_citas")
    .insert({
      empresa_id: args.empresaId,
      cliente_id: args.clienteId,
      responsable_id: args.agenda.responsableId,
      titulo: `Capacitación · ${args.clienteNombre}`.slice(0, 200),
      tipo: TIPO_CITA_CAPACITACION,
      estado: "pendiente",
      inicio_at: args.agenda.inicioIso,
      fin_at: args.agenda.finIso,
      ubicacion: args.agenda.ubicacion,
      observaciones: args.observaciones,
      metadata: { origen: "tipificacion" },
      created_by: args.creadoPor,
      updated_by: args.creadoPor,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, mensaje: error?.message ?? "No se pudo agendar la capacitación", status: 400 };
  const id = String((data as { id: string }).id);
  await guardarResponsables(sb, args.empresaId, id, args.agenda.responsableId, []).catch(() => {});
  return { ok: true, id };
}
