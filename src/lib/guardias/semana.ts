/**
 * La semana de guardia, siempre de lunes a domingo.
 *
 * Todo se guarda con la fecha del LUNES como clave, así que convertir una fecha
 * cualquiera a "su lunes" es la única operación que importa y vive acá, en un
 * módulo isomórfico que usan la API y el cliente.
 *
 * Se trabaja con la fecha en formato `YYYY-MM-DD` y no con `Date`: una guardia
 * es un día del calendario, no un instante, y meterle huso horario sólo
 * conseguiría que en Paraguay la semana empiece el domingo a las nueve.
 */

const MS_DIA = 86_400_000;

/** `YYYY-MM-DD` del lunes de la semana a la que pertenece la fecha dada. */
export function lunesDe(fecha: Date | string): string {
  const d = typeof fecha === "string" ? new Date(`${fecha}T12:00:00Z`) : new Date(fecha);
  // Mediodía UTC: deja margen para que ningún huso corra el día al redondear.
  const base = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const dia = new Date(base).getUTCDay(); // 0 = domingo
  const desplazamiento = dia === 0 ? 6 : dia - 1;
  return new Date(base - desplazamiento * MS_DIA).toISOString().slice(0, 10);
}

/** El lunes de la semana en curso, según el reloj de quien pregunta. */
export function lunesDeEstaSemana(): string {
  return lunesDe(new Date());
}

/** Suma semanas a un lunes y devuelve el lunes resultante. */
export function sumarSemanas(lunes: string, n: number): string {
  const d = new Date(`${lunes}T12:00:00Z`);
  return new Date(d.getTime() + n * 7 * MS_DIA).toISOString().slice(0, 10);
}

/** El domingo que cierra la semana de ese lunes. */
export function domingoDe(lunes: string): string {
  const d = new Date(`${lunes}T12:00:00Z`);
  return new Date(d.getTime() + 6 * MS_DIA).toISOString().slice(0, 10);
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "8 al 14 de septiembre" — y con los meses cruzados, "29 de sep. al 5 de oct.". */
export function rangoLegible(lunes: string): string {
  const dom = domingoDe(lunes);
  const [, mL, dL] = lunes.split("-").map(Number);
  const [, mD, dD] = dom.split("-").map(Number);
  if (mL === mD) return `${dL} al ${dD} de ${MESES[mL - 1]}`;
  return `${dL} de ${MESES[mL - 1].slice(0, 3)}. al ${dD} de ${MESES[mD - 1].slice(0, 3)}.`;
}

export function esLunesValido(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return lunesDe(v) === v;
}
