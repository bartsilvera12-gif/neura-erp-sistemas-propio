/**
 * Compromiso de entrega del esqueleto de un Proyecto Web.
 *
 * El equipo entrega el esqueleto (el modelo navegable del sitio) dentro de las
 * 24 a 48 horas de tomado el proyecto. Este módulo decide cuándo un proyecto
 * está por incumplir ese compromiso, para que la fila parpadee en el tablero y
 * el técnico reciba el aviso en la campanita.
 *
 * El reloj es de CALENDARIO salteando los domingos (`msSinDomingos`), no el
 * laboral: la promesa es en horas corridas, pero el domingo no cuenta porque la
 * empresa no abre. Es a propósito distinto del contador visible de la tarjeta,
 * que sí mide horas trabajadas.
 */

import { msSinDomingos } from "@/lib/proyectos/reloj-laboral";

const HORA_MS = 3_600_000;

/** Vencido: se cumplieron las 48 horas comprometidas. */
export const ESQUELETO_LIMITE_MS = 48 * HORA_MS;
/** Aviso previo: empieza a parpadear 5 horas antes del vencimiento. */
export const ESQUELETO_AVISO_MS = ESQUELETO_LIMITE_MS - 5 * HORA_MS;

/**
 * Código del tipo de proyecto al que aplica el compromiso. Los SaaS/ERP no
 * tienen esqueleto: no se los alarma.
 */
export const TIPO_CON_ESQUELETO = "web";

/**
 * El compromiso vive mientras el proyecto se está construyendo. Una vez que
 * pasó a QA, a Cambios o a Publicado, el esqueleto ya se entregó y el reloj
 * deja de tener sentido.
 */
export const ESTADO_CON_ESQUELETO = "desarrollo";

/**
 * Clave dentro de `proyectos.brief_data` que marca el hito cumplido. La escribe
 * el checkbox "Esqueleto entregado al cliente" de la pestaña Datos
 * (`PROYECTO_DATOS_BRIEF_FIELDS` en `brief-data.ts`): `true` cuando está
 * tildado, y la clave se borra al destildar.
 */
export const BRIEF_KEY_ESQUELETO_ENTREGADO = "esqueleto_entregado";

/**
 * ¿El técnico ya marcó el esqueleto como entregado?
 *
 * Sin esta marca el aviso no tendría forma de apagarse: un proyecto que sigue
 * semanas en Desarrollo quedaría con el cartel de vencido para siempre, aunque
 * el esqueleto se haya entregado el primer día.
 */
export function esqueletoEntregado(briefData: unknown): boolean {
  if (!briefData || typeof briefData !== "object" || Array.isArray(briefData)) return false;
  return (briefData as Record<string, unknown>)[BRIEF_KEY_ESQUELETO_ENTREGADO] === true;
}

export type EstadoEsqueleto = "ok" | "por_vencer" | "vencido";

export type EvaluacionEsqueleto = {
  /** `false` cuando el compromiso no corre para este proyecto (tipo, estado o pausa). */
  aplica: boolean;
  estado: EstadoEsqueleto;
  /** Tiempo consumido del compromiso, en ms (calendario sin domingos). */
  transcurridoMs: number | null;
  /** Lo que falta para las 48 h. Negativo si ya venció. */
  restanteMs: number | null;
};

const NO_APLICA: EvaluacionEsqueleto = {
  aplica: false,
  estado: "ok",
  transcurridoMs: null,
  restanteMs: null,
};

/**
 * Evalúa el compromiso de esqueleto de un proyecto.
 *
 * `desde` es el mismo instante en que arranca el contador de la tarjeta: cuándo
 * el proyecto quedó en manos del técnico. Sin técnico asignado no hay
 * compromiso que medir.
 */
export function evaluarEsqueleto(args: {
  tipoCodigo: string | null | undefined;
  estadoCodigo: string | null | undefined;
  desde: string | null | undefined;
  pausado: boolean;
  /** Contenido de `proyectos.brief_data`; si trae el hito marcado, no hay aviso. */
  briefData?: unknown;
  ahoraIso?: string | null;
}): EvaluacionEsqueleto {
  if ((args.tipoCodigo ?? "") !== TIPO_CON_ESQUELETO) return NO_APLICA;
  if ((args.estadoCodigo ?? "") !== ESTADO_CON_ESQUELETO) return NO_APLICA;
  // El hito ya está cumplido: no hay plazo que vigilar.
  if (esqueletoEntregado(args.briefData)) return NO_APLICA;
  // Un proyecto detenido esperando al cliente no puede incumplir un plazo
  // nuestro: el aviso reaparece cuando se reanuda.
  if (args.pausado) return NO_APLICA;

  const transcurridoMs = msSinDomingos(args.desde, args.ahoraIso ?? null);
  if (transcurridoMs == null) return NO_APLICA;

  const restanteMs = ESQUELETO_LIMITE_MS - transcurridoMs;
  const estado: EstadoEsqueleto =
    transcurridoMs >= ESQUELETO_LIMITE_MS
      ? "vencido"
      : transcurridoMs >= ESQUELETO_AVISO_MS
        ? "por_vencer"
        : "ok";

  return { aplica: true, estado, transcurridoMs, restanteMs };
}

/** Texto corto del aviso, compartido por el tablero y la campanita. */
export function textoEsqueleto(ev: EvaluacionEsqueleto): string | null {
  if (!ev.aplica || ev.estado === "ok" || ev.restanteMs == null) return null;
  if (ev.estado === "vencido") {
    const horas = Math.floor(-ev.restanteMs / HORA_MS);
    return horas >= 1
      ? `Esqueleto vencido hace ${horas} h`
      : "Esqueleto vencido — se cumplieron las 48 h";
  }
  const horas = Math.max(1, Math.ceil(ev.restanteMs / HORA_MS));
  return `Esqueleto por vencer — quedan ${horas} h`;
}
