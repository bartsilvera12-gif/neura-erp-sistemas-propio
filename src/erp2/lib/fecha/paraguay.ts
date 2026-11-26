/**
 * Hora de Paraguay. El servidor (contenedor) y la base corren en UTC: todo lo que
 * dependa del "día" o se muestre con hora tiene que pasar por America/Asuncion, o
 * de 21:00 a 23:59 queda fechado al día siguiente (UTC va 3 horas adelante).
 * Paraguay está en UTC-3 todo el año desde oct-2024 (tzdata 2024b+).
 */
export const TZ_PY = "America/Asuncion";

/** Fecha de hoy en Paraguay, "YYYY-MM-DD". */
export const hoyPY = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ_PY });

/**
 * Horas siempre en 24 h ("14:35", nunca "2:35 p. m."): "es-PY" sale en 12 h por defecto.
 * Se usa hourCycle "h23" y no hour12:false, que en algunos motores da "24:05".
 * Sumalo a cualquier formato con hora: `{ ...HORA_24, timeZone: TZ_PY, ... }`.
 */
export const HORA_24 = { hourCycle: "h23" } as const;

const F_HORA = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const F_FECHA_HORA = new Intl.DateTimeFormat("es-PY", {
  timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const aFecha = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

/** "14:35" en hora de Paraguay. */
export const hora = (v: string | number | Date) => F_HORA.format(aFecha(v));

/** "28/10/2026, 14:35" en hora de Paraguay. */
export const fechaHora = (v: string | number | Date) => F_FECHA_HORA.format(aFecha(v));
