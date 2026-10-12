import type { SupabaseAdmin } from "@/lib/chat/types";

/**
 * Horario en el que cada persona acepta notificaciones push, con una franja POR DÍA.
 *
 * Por qué vive en el servidor y no en la app: en iOS, que una notificación llegue y suene lo
 * decide el payload que manda el servidor. La app recibe lo que le mandan y no puede
 * silenciar nada después. Así que la pantalla de configuración está en la app, pero la
 * decisión se toma acá, justo antes de enviar.
 *
 * Fuera del horario NO se manda nada: el asesor se entera al abrir la app.
 */

const LOG = "[horario-notificaciones]";
const ZONA = "America/Asuncion";

/** `[desde, hasta]` en horas enteras 0-23. `desde > hasta` = la franja cruza la medianoche. */
export type Franja = [number, number];

/** Día 0 = domingo … 6 = sábado. Un día ausente no recibe notificaciones. */
export type Franjas = Record<string, Franja>;

export type HorarioNotificaciones = {
  /** Interruptor general. En false no se manda NINGUNA notificación, haya horario o no. */
  notificar: boolean;
  /** Si está en false, se notifica a cualquier hora. */
  activo: boolean;
  franjas: Franjas;
};

/** Guardia semanal: los siete días de 08:00 a 21:00. */
export const PRESET_GUARDIA_SEMANAL: Franjas = {
  "0": [8, 21],
  "1": [8, 21],
  "2": [8, 21],
  "3": [8, 21],
  "4": [8, 21],
  "5": [8, 21],
  "6": [8, 21],
};

export const HORARIO_POR_DEFECTO: HorarioNotificaciones = {
  notificar: true,
  activo: false,
  franjas: { "1": [8, 20], "2": [8, 20], "3": [8, 20], "4": [8, 20], "5": [8, 20] },
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

function franjaDe(franjas: Franjas, dia: number): Franja | null {
  const f = franjas?.[String(dia)];
  if (!Array.isArray(f) || f.length < 2) return null;
  const desde = Math.max(0, Math.min(23, Math.trunc(Number(f[0]))));
  const hasta = Math.max(0, Math.min(23, Math.trunc(Number(f[1]))));
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde === hasta) return null;
  return [desde, hasta];
}

/** ¿El momento actual cae dentro de alguna franja configurada? */
export function estaDentroDelHorario(h: HorarioNotificaciones): boolean {
  if (!h.notificar) return false; // apagado del todo
  if (!h.activo) return true; // sin restricción de horario, siempre se notifica
  const { dia, hora } = ahoraEnParaguay();

  const hoy = franjaDe(h.franjas, dia);
  if (hoy) {
    const [desde, hasta] = hoy;
    if (desde < hasta && hora >= desde && hora < hasta) return true;
    // Franja que cruza la medianoche: desde la hora de inicio hasta el final del día.
    if (desde > hasta && hora >= desde) return true;
  }

  // La madrugada pertenece a la franja del día ANTERIOR: quien configura "viernes de 20 a 6"
  // espera que le suene el sábado a las 2. Mirando sólo el día en curso, esas horas quedaban
  // afuera.
  const ayer = franjaDe(h.franjas, (dia + 6) % 7);
  if (ayer) {
    const [desde, hasta] = ayer;
    if (desde > hasta && hora < hasta) return true;
  }
  return false;
}

/** Normaliza lo que llega de afuera: descarta días y horas inválidos. */
export function limpiarFranjas(entrada: unknown): Franjas {
  const salida: Franjas = {};
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return salida;
  for (const [clave, valor] of Object.entries(entrada as Record<string, unknown>)) {
    const dia = Number(clave);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) continue;
    if (!Array.isArray(valor) || valor.length < 2) continue;
    const desde = Math.trunc(Number(valor[0]));
    const hasta = Math.trunc(Number(valor[1]));
    if (!Number.isFinite(desde) || !Number.isFinite(hasta)) continue;
    if (desde < 0 || desde > 23 || hasta < 0 || hasta > 23) continue;
    // Desde y hasta iguales no dejan pasar nada: se descarta el día en vez de guardar una
    // franja que silencia sin que se note.
    if (desde === hasta) continue;
    salida[String(dia)] = [desde, hasta];
  }
  return salida;
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
      .select("activo, franjas, notificar")
      .eq("usuario_id", usuarioId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      // Si la columna todavía no existe, se asume encendido: no apagar a nadie por una
      // migración a medio aplicar.
      notificar: row.notificar !== false,
      activo: row.activo === true,
      franjas: limpiarFranjas(row.franjas),
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
