import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { responsablesPorCita } from "@/lib/agenda/responsables";

/**
 * La reunión que se muestra en la barra de arriba: la que está en curso o, si no hay,
 * la próxima de HOY. Sólo las que son de la persona — responsable principal o sumada
 * como responsable —, no las que cargó para otro.
 */

/** Estados en los que la reunión ya no va a pasar o ya pasó. */
const NO_VAN = new Set(["cancelada", "reprogramada", "completada", "no_asistio"]);

/** Sin hora de fin, una reunión se considera en curso esta cantidad de minutos. */
const DURACION_SUPUESTA_MIN = 60;

export type ProximaReunion = {
  cita_id: string;
  titulo: string;
  inicio_at: string;
  fin_at: string | null;
  ubicacion: string | null;
  en_curso: boolean;
};

/** Fin del día de hoy en Paraguay (UTC-3), como instante. */
function finDeHoyPY(ahora: number): number {
  const py = new Date(ahora - 3 * 3600_000);
  const fin = Date.UTC(py.getUTCFullYear(), py.getUTCMonth(), py.getUTCDate(), 23, 59, 59);
  return fin + 3 * 3600_000;
}

export async function proximaReunionDe(
  sb: AppSupabaseClient,
  empresaId: string,
  usuarioId: string
): Promise<ProximaReunion | null> {
  const ahora = Date.now();
  // Desde unas horas atrás, para encontrar la que está en curso.
  const desde = new Date(ahora - 6 * 3600_000).toISOString();
  const hasta = new Date(finDeHoyPY(ahora)).toISOString();

  const { data, error } = await sb
    .from("agenda_citas")
    .select("id, titulo, inicio_at, fin_at, estado, responsable_id, ubicacion")
    .eq("empresa_id", empresaId)
    .gte("inicio_at", desde)
    .lte("inicio_at", hasta)
    .order("inicio_at", { ascending: true });
  if (error) return null;

  const citas = ((data ?? []) as {
    id: string;
    titulo: string;
    inicio_at: string;
    fin_at: string | null;
    estado: string;
    responsable_id: string;
    ubicacion: string | null;
  }[]).filter((c) => !NO_VAN.has(c.estado));
  if (citas.length === 0) return null;

  const extras = await responsablesPorCita(
    sb,
    empresaId,
    citas.map((c) => c.id)
  ).catch(() => null);
  const mias = citas.filter(
    (c) => c.responsable_id === usuarioId || (extras?.get(c.id) ?? []).includes(usuarioId)
  );

  const finDe = (c: (typeof mias)[number]) =>
    c.fin_at ? Date.parse(c.fin_at) : Date.parse(c.inicio_at) + DURACION_SUPUESTA_MIN * 60_000;

  const enCurso = mias.find((c) => Date.parse(c.inicio_at) <= ahora && ahora < finDe(c));
  const elegida = enCurso ?? mias.find((c) => Date.parse(c.inicio_at) > ahora);
  if (!elegida) return null;

  return {
    cita_id: elegida.id,
    titulo: elegida.titulo,
    inicio_at: elegida.inicio_at,
    fin_at: elegida.fin_at,
    ubicacion: elegida.ubicacion?.trim() || null,
    en_curso: !!enCurso,
  };
}
