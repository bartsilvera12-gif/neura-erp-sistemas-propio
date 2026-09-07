/**
 * Retrabajo: cuántas veces un proyecto pasó por QA.
 *
 * No hay —ni tiene que haber— estados "Re-QA" o "Re-Re-QA". La columna QA es
 * una sola y el proyecto puede volver a entrar; el historial ya guarda cada
 * entrada, así que las rondas se CUENTAN, no se modelan.
 *
 * Una ronda = una entrada real a un estado de QA. Dos filas seguidas del mismo
 * estado (que el tablero puede generar al reabrir una revisión) cuentan una
 * sola vez: lo que interesa es cuántas veces QA tuvo que mirar el trabajo.
 */

import type { SegmentoHistorial } from "./technical-slv";

export type QaProyecto = {
  proyecto_id: string;
  rondas: number;
  /** Volvió de QA a desarrollo o cambios al menos una vez. */
  reingreso: boolean;
  /** Aprobado sin volver nunca de QA. `null` mientras no haya pasado por QA. */
  first_pass: boolean | null;
  /** Entrada a la última ronda, para mostrar "hace cuánto está en QA". */
  ultima_entrada_at: string | null;
};

export function qaDeProyecto(
  proyectoId: string,
  filas: SegmentoHistorial[],
  esEstadoQa: (estadoId: string) => boolean,
  esEstadoTecnico: (estadoId: string) => boolean
): QaProyecto {
  const segmentos = filas
    .filter((f) => f.estado_nuevo_id != null && typeof f.entered_at === "string")
    .sort((a, b) => Date.parse(a.entered_at as string) - Date.parse(b.entered_at as string));

  let rondas = 0;
  let reingreso = false;
  let ultima: string | null = null;
  let anteriorEraQa = false;
  let vieneDeQa = false;

  for (const s of segmentos) {
    const id = s.estado_nuevo_id as string;
    const esQa = esEstadoQa(id);
    if (esQa) {
      if (!anteriorEraQa) {
        rondas += 1;
        ultima = s.entered_at;
      }
      vieneDeQa = true;
    } else {
      // Devolución: salió de QA y volvió a manos del técnico.
      if (vieneDeQa && esEstadoTecnico(id)) reingreso = true;
      vieneDeQa = false;
    }
    anteriorEraQa = esQa;
  }

  return {
    proyecto_id: proyectoId,
    rondas,
    reingreso,
    first_pass: rondas === 0 ? null : rondas === 1 && !reingreso,
    ultima_entrada_at: ultima,
  };
}

export type QaResumen = {
  proyectos_con_qa: number;
  first_pass_pct: number | null;
  con_reingreso_pct: number | null;
  promedio_rondas: number | null;
  con_tres_o_mas: number;
};

export function resumirQa(items: QaProyecto[]): QaResumen {
  const conQa = items.filter((q) => q.rondas > 0);
  if (conQa.length === 0) {
    return {
      proyectos_con_qa: 0,
      first_pass_pct: null,
      con_reingreso_pct: null,
      promedio_rondas: null,
      con_tres_o_mas: 0,
    };
  }
  const fp = conQa.filter((q) => q.first_pass === true).length;
  const re = conQa.filter((q) => q.reingreso).length;
  const suma = conQa.reduce((a, q) => a + q.rondas, 0);
  return {
    proyectos_con_qa: conQa.length,
    first_pass_pct: Math.round((fp / conQa.length) * 100),
    con_reingreso_pct: Math.round((re / conQa.length) * 100),
    promedio_rondas: Math.round((suma / conQa.length) * 10) / 10,
    con_tres_o_mas: conQa.filter((q) => q.rondas >= 3).length,
  };
}
