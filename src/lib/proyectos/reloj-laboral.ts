/**
 * Relojes de negocio del tablero de proyectos.
 *
 * Hay DOS relojes distintos y a propósito, porque miden cosas distintas:
 *
 *  1. `msLaborables` — tiempo de trabajo real. Corre sólo dentro del horario de
 *     la empresa (lunes a viernes de 8 a 17, sábados de 8 a 12). Es el que
 *     alimenta el contador que se ve en la tarjeta del técnico: un proyecto que
 *     pasa el domingo quieto no tiene que sumar horas ni pintarse de rojo.
 *
 *  2. `msSinDomingos` — tiempo de calendario salteando los domingos. Es el que
 *     mide el compromiso de entrega del esqueleto de un Proyecto Web ("24 a 48
 *     horas"): ahí la promesa es en horas corridas, no en horas trabajadas, pero
 *     el domingo no cuenta porque nadie abre.
 *
 * Ambos se calculan en O(1) (aritmética de semanas + un bucle fijo de 7 días),
 * así que el contador del cliente puede recalcularse cada segundo para decenas
 * de proyectos sin costo perceptible.
 *
 * Módulo isomórfico: lo importan la API y el cliente.
 */

/**
 * Paraguay quedó en UTC-3 fijo: derogó el horario de verano a partir de 2024
 * (Decreto 2867/2024). Al no haber saltos de DST alcanza con un offset
 * constante, que es lo que permite resolver todo con aritmética en vez de
 * consultar `Intl` instante por instante.
 *
 * Si algún día vuelve el horario de verano, éste es el único punto a tocar —y
 * el cálculo pasaría a necesitar el offset real de cada instante.
 */
export const TZ_OFFSET_MIN = -180;

const MIN_MS = 60_000;
const HORA_MS = 60 * MIN_MS;
const DIA_MS = 24 * HORA_MS;
const SEMANA_MS = 7 * DIA_MS;

/** Ventana `[desdeMin, hastaMin]` en minutos desde la medianoche local. */
type Ventana = readonly [number, number];

/**
 * Horario de la empresa, indexado desde el LUNES (0 = lunes … 6 = domingo).
 * El ancla del cálculo es un lunes, así que este orden es el que evita tener
 * que traducir índices en el bucle.
 */
const HORARIO_LABORAL: readonly (Ventana | null)[] = [
  [8 * 60, 17 * 60], // lunes
  [8 * 60, 17 * 60], // martes
  [8 * 60, 17 * 60], // miércoles
  [8 * 60, 17 * 60], // jueves
  [8 * 60, 17 * 60], // viernes
  [8 * 60, 12 * 60], // sábado
  null, // domingo — cerrado
];

/** Calendario corrido salvo el domingo. Mismo orden: 0 = lunes. */
const HORARIO_SIN_DOMINGO: readonly (Ventana | null)[] = [
  [0, 24 * 60],
  [0, 24 * 60],
  [0, 24 * 60],
  [0, 24 * 60],
  [0, 24 * 60],
  [0, 24 * 60],
  null, // domingo
];

function msPorSemana(horario: readonly (Ventana | null)[]): number {
  let total = 0;
  for (const v of horario) if (v) total += (v[1] - v[0]) * MIN_MS;
  return total;
}

/** 49 h: cinco jornadas de 9 h más el sábado de 4 h. */
export const MS_LABORALES_POR_SEMANA = msPorSemana(HORARIO_LABORAL);
/** 144 h: seis días corridos. */
export const MS_SIN_DOMINGO_POR_SEMANA = msPorSemana(HORARIO_SIN_DOMINGO);

/** Duración de la jornada estándar de lunes a viernes. Sirve para expresar el contador en jornadas. */
export const MS_JORNADA = 9 * HORA_MS;

/**
 * Ancla del cálculo: lunes 3 de enero de 2000, 00:00 hora local.
 *
 * Se trabaja en "milisegundos de reloj local" (el instante UTC corrido por el
 * offset), así que el ancla se expresa con `Date.UTC` sobre esa misma escala.
 */
const ANCLA_LOCAL_MS = Date.UTC(2000, 0, 3);

/** Instante UTC -> milisegundos de reloj de pared local. */
function aLocal(ms: number): number {
  return ms + TZ_OFFSET_MIN * MIN_MS;
}

/**
 * Milisegundos hábiles acumulados entre el ancla y `localMs`, para un horario dado.
 *
 * Las semanas completas salen de una multiplicación; sólo el resto (menos de
 * una semana) se recorre día por día, y son siempre 7 iteraciones.
 */
function acumulado(localMs: number, horario: readonly (Ventana | null)[], msSemana: number): number {
  const delta = localMs - ANCLA_LOCAL_MS;
  if (delta <= 0) return 0;

  const semanas = Math.floor(delta / SEMANA_MS);
  const resto = delta - semanas * SEMANA_MS;

  let total = semanas * msSemana;
  for (let d = 0; d < 7; d++) {
    const ventana = horario[d];
    if (!ventana) continue;
    const inicio = d * DIA_MS + ventana[0] * MIN_MS;
    const fin = d * DIA_MS + ventana[1] * MIN_MS;
    // Intersección de la ventana del día con [0, resto].
    if (resto <= inicio) break;
    total += Math.min(resto, fin) - inicio;
    if (resto <= fin) break;
  }
  return total;
}

function entre(
  desdeIso: string | null | undefined,
  hastaIso: string | null | undefined,
  horario: readonly (Ventana | null)[],
  msSemana: number
): number | null {
  if (typeof desdeIso !== "string" || !desdeIso.trim()) return null;
  const desde = Date.parse(desdeIso);
  if (!Number.isFinite(desde)) return null;

  const hasta =
    typeof hastaIso === "string" && hastaIso.trim() ? Date.parse(hastaIso) : Date.now();
  if (!Number.isFinite(hasta)) return null;

  const ms =
    acumulado(aLocal(hasta), horario, msSemana) - acumulado(aLocal(desde), horario, msSemana);
  return Math.max(0, ms);
}

/**
 * Milisegundos de horario laboral entre dos instantes (lun–vie 8–17, sáb 8–12).
 * `null` si la fecha de inicio no es parseable.
 */
export function msLaborables(
  desdeIso: string | null | undefined,
  hastaIso?: string | null
): number | null {
  return entre(desdeIso, hastaIso, HORARIO_LABORAL, MS_LABORALES_POR_SEMANA);
}

/**
 * Milisegundos de calendario entre dos instantes, salteando los domingos.
 * `null` si la fecha de inicio no es parseable.
 */
export function msSinDomingos(
  desdeIso: string | null | undefined,
  hastaIso?: string | null
): number | null {
  return entre(desdeIso, hastaIso, HORARIO_SIN_DOMINGO, MS_SIN_DOMINGO_POR_SEMANA);
}

/** ¿El instante cae dentro del horario de trabajo? Sirve para explicar un contador congelado. */
export function enHorarioLaboral(ms: number = Date.now()): boolean {
  const local = aLocal(ms);
  const delta = local - ANCLA_LOCAL_MS;
  if (delta <= 0) return false;
  const enSemana = ((delta % SEMANA_MS) + SEMANA_MS) % SEMANA_MS;
  const dia = Math.floor(enSemana / DIA_MS);
  const ventana = HORARIO_LABORAL[dia];
  if (!ventana) return false;
  const minutoDelDia = (enSemana - dia * DIA_MS) / MIN_MS;
  return minutoDelDia >= ventana[0] && minutoDelDia < ventana[1];
}

export type Duracion = {
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
  totalMs: number;
};

export function descomponer(ms: number): Duracion {
  const total = Math.max(0, Math.floor(ms));
  const segundos = Math.floor(total / 1000);
  return {
    dias: Math.floor(segundos / 86400),
    horas: Math.floor((segundos % 86400) / 3600),
    minutos: Math.floor((segundos % 3600) / 60),
    segundos: segundos % 60,
    totalMs: total,
  };
}

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * Formato del contador: `3d 04:12:37`, o `04:12:37` cuando todavía no llegó al día.
 *
 * El "día" son 24 horas de tiempo acumulado, no una jornada: es un formato de
 * duración. Para la lectura en jornadas de trabajo está `enJornadas()`, que es
 * lo que se muestra en el tooltip.
 */
export function formatearDuracion(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const d = descomponer(ms);
  const reloj = `${dosDigitos(d.horas)}:${dosDigitos(d.minutos)}:${dosDigitos(d.segundos)}`;
  return d.dias > 0 ? `${d.dias}d ${reloj}` : reloj;
}

/** El mismo tiempo leído en jornadas de 9 h, que es como lo piensa el equipo. */
export function enJornadas(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round((ms / MS_JORNADA) * 10) / 10;
}
