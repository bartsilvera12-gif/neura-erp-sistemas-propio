import type { SupabaseAdmin } from "@/lib/chat/types";

/**
 * Horario en el que cada persona acepta notificaciones push.
 *
 * Por qué vive en el servidor y no en la app: en iOS, que una notificación llegue y suene lo
 * decide el payload que manda el servidor. La app recibe lo que le mandan y no puede
 * silenciar nada después. Así que la pantalla de configuración está en la app, pero la
 * decisión se toma acá, justo antes de enviar.
 *
 * Fuera del horario NO se manda nada (es lo que se eligió): el asesor se entera al abrir la
 * app. Por eso conviene que el horario sea generoso.
 */

const LOG = "[horario-notificaciones]";
const ZONA = "America/Asuncion";

export type HorarioNotificaciones = {
  activo: boolean;
  /** 0 = domingo … 6 = sábado. */
  dias: number[];
  /** Hora de inicio, 0-23. */
  hora_desde: number;
  /** Hora de fin, 0-23. Si es menor que `hora_desde`, el tramo cruza la medianoche. */
  hora_hasta: number;
};

export const HORARIO_POR_DEFECTO: HorarioNotificaciones = {
  activo: false,
  dias: [1, 2, 3, 4, 5],
  hora_desde: 8,
  hora_hasta: 20,
};

/** Día de la semana y hora actuales en Paraguay, sin importar dónde corra el servidor. */
function ahoraEnParaguay(): { dia: number; hora: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dia = dias[f.find((p) => p.type === "weekday")?.value ?? ""] ?? 0;
  const hora = Number(f.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return { dia, hora };
}

/** ¿El momento actual cae dentro del horario configurado? */
export function estaDentroDelHorario(h: HorarioNotificaciones): boolean {
  if (!h.activo) return true; // sin restricción configurada, siempre se notifica
  const { dia, hora } = ahoraEnParaguay();

  const desde = Math.max(0, Math.min(23, Math.trunc(h.hora_desde)));
  const hasta = Math.max(0, Math.min(23, Math.trunc(h.hora_hasta)));

  // Tramo que cruza la medianoche (ej. de 20 a 6): la madrugada pertenece al día ANTERIOR,
  // porque quien configura "de 20 a 6 los viernes" espera que suene el sábado a las 2 de la
  // mañana. Tratarlo como el día en curso dejaría esas horas afuera.
  if (desde > hasta) {
    if (hora >= desde) return h.dias.includes(dia);
    if (hora < hasta) return h.dias.includes((dia + 6) % 7);
    return false;
  }

  if (!h.dias.includes(dia)) return false;
  return hora >= desde && hora < hasta;
}

/**
 * El horario de una persona. Devuelve `null` si no configuró nada o si no se pudo leer.
 *
 * Nunca lanza: si la tabla todavía no existe (migración sin aplicar) o la consulta falla, se
 * devuelve null y el que llama manda la notificación igual. Perder un aviso por una consulta
 * fallida es peor que uno de más.
 */
export async function horarioDeUsuario(
  sb: SupabaseAdmin,
  usuarioId: string
): Promise<HorarioNotificaciones | null> {
  if (!usuarioId) return null;
  try {
    const { data, error } = await sb
      .from("usuario_horario_notificaciones")
      .select("activo, dias, hora_desde, hora_hasta")
      .eq("usuario_id", usuarioId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      activo: row.activo === true,
      dias: Array.isArray(row.dias) ? (row.dias as unknown[]).map((d) => Number(d)) : [],
      hora_desde: Number(row.hora_desde ?? 0),
      hora_hasta: Number(row.hora_hasta ?? 0),
    };
  } catch (e) {
    console.warn(LOG, "no_se_pudo_leer", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** ¿Se le puede mandar una push a esta persona ahora mismo? */
export async function puedeNotificarAhora(sb: SupabaseAdmin, usuarioId: string): Promise<boolean> {
  const h = await horarioDeUsuario(sb, usuarioId);
  if (!h) return true;
  return estaDentroDelHorario(h);
}
