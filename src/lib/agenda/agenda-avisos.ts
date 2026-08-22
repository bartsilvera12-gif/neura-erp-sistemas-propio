import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { responsablesPorCita } from "@/lib/agenda/responsables";
import { ESTADOS_NO_BLOQUEAN } from "@/lib/agenda/types";
import { horaPY } from "@/lib/format/hora-py";

/**
 * Recordatorios de reunión para la campanita, calculados al leerla.
 *
 * Mismo criterio que `esqueleto-avisos.ts`, y por las mismas razones:
 *
 *  - "Faltan 30 minutos para tu reunión" es una CONDICIÓN, no un hecho: deja de
 *    ser cierta sola cuando pasa la hora. Una fila persistida quedaría mintiendo
 *    hasta que alguien la marque leída.
 *  - No hace falta un cron que barra la agenda cada pocos minutos, ni una tabla
 *    que se llene de recordatorios viejos.
 *
 * La contrapartida es que no se pueden marcar como leídos: se apagan solos
 * cuando la reunión empieza, se cancela o se reprograma.
 */

/** Ventanas de aviso, en minutos antes del inicio. De la más lejana a la más cercana. */
const VENTANAS_MIN = [60, 30] as const;

/**
 * Margen de tolerancia: la campanita no se lee en el minuto exacto. Sin esto,
 * un aviso de "60 minutos" sólo existiría durante el minuto 60 y en la práctica
 * casi nadie lo vería.
 */
const TOLERANCIA_MIN = 5;

export type AvisoAgenda = {
  id: string;
  tipo: "agenda_recordatorio";
  titulo: string;
  cuerpo: string;
  proyecto_id: null;
  observacion_id: null;
  agrupadas: number;
  leida_at: null;
  created_at: string;
  /** Calculado en vivo, sin fila en la base: no se puede marcar leído. */
  derivada: true;
  /** Minutos que faltan (60 o 30). La UI lo usa para el énfasis del sonido. */
  minutos_restantes: number;
  cita_id: string;
};

type CitaRow = {
  id: string;
  titulo: string;
  inicio_at: string;
  estado: string;
  responsable_id: string;
  created_by: string | null;
  ubicacion: string | null;
};

/**
 * Avisos de las reuniones próximas de un usuario.
 *
 * Destinatarios: los responsables de la cita MÁS quien la cargó (`created_by`).
 * Si quien cargó es además responsable, le llega una sola vez — la consulta ya
 * devuelve una fila por cita, no por rol.
 */
export async function avisosAgendaDe(
  sb: AppSupabaseClient,
  empresaId: string,
  usuarioId: string
): Promise<AvisoAgenda[]> {
  const ahora = Date.now();
  const masLejana = VENTANAS_MIN[0] + TOLERANCIA_MIN;
  const desde = new Date(ahora).toISOString();
  const hasta = new Date(ahora + masLejana * 60_000).toISOString();

  const { data, error } = await sb
    .from("agenda_citas")
    .select("id, titulo, inicio_at, estado, responsable_id, created_by, ubicacion")
    .eq("empresa_id", empresaId)
    .gte("inicio_at", desde)
    .lte("inicio_at", hasta);

  // La campanita no puede caerse porque la agenda falle: sin avisos es
  // degradado aceptable, un 500 en el header no.
  if (error) return [];

  const citas = (data ?? []) as CitaRow[];
  if (citas.length === 0) return [];

  // Una cita cancelada o reprogramada ya no va a pasar: no se recuerda.
  const vigentes = citas.filter((c) => !ESTADOS_NO_BLOQUEAN.has(c.estado));
  if (vigentes.length === 0) return [];

  const extras = await responsablesPorCita(
    sb,
    empresaId,
    vigentes.map((c) => c.id)
  ).catch(() => null);

  const mias = vigentes.filter((c) => {
    if (c.responsable_id === usuarioId) return true;
    if (c.created_by === usuarioId) return true;
    return (extras?.get(c.id) ?? []).includes(usuarioId);
  });

  const avisos: AvisoAgenda[] = [];
  for (const c of mias) {
    const faltanMin = (Date.parse(c.inicio_at) - ahora) / 60_000;
    if (!Number.isFinite(faltanMin) || faltanMin < 0) continue;

    // Se elige la ventana más cercana que ya se alcanzó: a 25 minutos
    // corresponde el aviso de 30, no el de 60, y nunca los dos a la vez.
    const ventana = VENTANAS_MIN.find(
      (v) => faltanMin <= v + TOLERANCIA_MIN && faltanMin > (v === 30 ? -1 : 30 + TOLERANCIA_MIN)
    );
    if (ventana == null) continue;

    const restantes = Math.max(1, Math.round(faltanMin));
    avisos.push({
      // Id estable por cita+ventana: el cliente lo usa como key y para no
      // volver a sonar por el mismo aviso en cada refresco.
      id: `agenda:${c.id}:${ventana}`,
      tipo: "agenda_recordatorio",
      titulo: ventana === 30 ? `En ${restantes} min: ${c.titulo}` : `Hoy ${horaPY(c.inicio_at)}: ${c.titulo}`,
      cuerpo: [`Empieza a las ${horaPY(c.inicio_at)}`, c.ubicacion?.trim() || null]
        .filter(Boolean)
        .join(" · "),
      proyecto_id: null,
      observacion_id: null,
      agrupadas: 1,
      leida_at: null,
      created_at: new Date().toISOString(),
      derivada: true,
      minutos_restantes: restantes,
      cita_id: c.id,
    });
  }

  // Lo más inminente primero.
  return avisos.sort((a, b) => a.minutos_restantes - b.minutos_restantes);
}
