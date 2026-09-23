/**
 * Cuándo limpia cada servidor.
 *
 * ÚNICO lugar donde se define la programación. Está expresada en **UTC**, que
 * es como corren los servidores y como disparan los crons; la pantalla la
 * muestra convertida a la hora de Paraguay.
 */

export type ProgramacionLimpieza =
  /** Al minuto 0 de cada hora UTC múltiplo de `horas` (0, 2, 4… si son 2). */
  | { tipo: "cada"; horas: number; texto: string }
  /** Todos los días a esa hora UTC en punto. */
  | { tipo: "diaria"; horaUtc: number; texto: string };

export const LIMPIEZA_POR_SERVIDOR: Record<string, ProgramacionLimpieza> = {
  produccion: { tipo: "cada", horas: 2, texto: "Cada 2 horas" },
  build: { tipo: "cada", horas: 6, texto: "Cada 6 horas" },
  hostinger: { tipo: "diaria", horaUtc: 7, texto: "Todos los días" },
};

/** Próximo disparo, estrictamente posterior a `ahora`. Todo el cálculo en UTC. */
export function proximaLimpieza(prog: ProgramacionLimpieza, ahora: Date): Date {
  if (prog.tipo === "diaria") {
    const c = new Date(ahora);
    c.setUTCHours(prog.horaUtc, 0, 0, 0);
    if (c <= ahora) c.setUTCDate(c.getUTCDate() + 1);
    return c;
  }

  const n = Math.max(1, Math.floor(prog.horas));
  const c = new Date(ahora);
  // Se arranca desde la última hora válida y se avanza de a `n` horas. UTC no
  // tiene horario de verano, así que sumar milisegundos no desalinea nada.
  c.setUTCHours(Math.floor(c.getUTCHours() / n) * n, 0, 0, 0);
  let t = c.getTime();
  while (t <= ahora.getTime()) t += n * 3_600_000;
  return new Date(t);
}

/**
 * La hora como la lee alguien en Paraguay: 12 horas, AM/PM en mayúsculas y sin
 * cero adelante ("3:00 PM", "4:00 AM"). Se formatea con `en-US` a propósito:
 * `es-PY` devuelve "3:00 p. m.", que no es lo pedido.
 */
export function horaParaguay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Asuncion",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .replace(/ | /g, " ")
    .toUpperCase();
}
