/**
 * SLV técnico del desarrollador: cuánto tiempo LABORAL estuvo un proyecto
 * efectivamente en manos de cada técnico.
 *
 * Es la pieza más delicada del dashboard, así que vale explicar por qué no
 * alcanza con lo que ya había:
 *
 *  - `computeSlaTotales` (sla-from-historial) mide el reloj del PROYECTO por
 *    `tipo_sla` (interno / cliente / pausado) en horas corridas. Sirve para el
 *    SLA comercial, pero mezcla los tres relojes que acá hay que separar.
 *  - `duration_seconds` del historial también es tiempo corrido. Un segmento
 *    abierto el viernes a las 17 h y cerrado el lunes a las 8 h son 63 h
 *    corridas y 0 h de trabajo.
 *
 * Entonces: se recorren los SEGMENTOS de estado del historial, se filtran los
 * que son de responsabilidad técnica, y cada tramo se mide con `msLaborables`.
 *
 * REASIGNACIONES
 * --------------
 * Reasignar un técnico NO parte el segmento de estado: se registra como un
 * evento puntual (`metadata.tipo = "reasignacion_tecnico"`, con `de` y `a`).
 * Si se atribuyera el segmento entero al `responsable_tecnico_id` que quedó en
 * el snapshot, un proyecto que Karen trabajó 8 h y se pasó a Iván le sumaría
 * las 8 h a uno de los dos. Por eso el segmento se PARTE en memoria contra la
 * línea de tiempo de reasignaciones, y cada tramo se le suma a quien lo tenía.
 *
 * CALIDAD HISTÓRICA
 * -----------------
 * El backfill de `responsable_tecnico_id` copió el técnico ACTUAL a todos los
 * segmentos viejos, así que para lo anterior a esa migración la atribución es
 * best-effort. No se inventa nada: se informa con `atribucion_confiable`.
 */

import { msLaborables } from "@/lib/proyectos/reloj-laboral";

export type SegmentoHistorial = {
  proyecto_id: string;
  estado_nuevo_id: string | null;
  entered_at: string | null;
  exited_at: string | null;
  responsable_tecnico_id: string | null;
  metadata: unknown;
};

export type SlvProyecto = {
  proyecto_id: string;
  /** Tiempo laboral total en estados de responsabilidad técnica, sin importar quién. */
  total_ms: number;
  /** Tiempo laboral por técnico. La suma da `total_ms`. */
  por_tecnico: Map<string, number>;
  /** Técnico con más tiempo acumulado: el "dueño" del trabajo para reportes. */
  tecnico_principal_id: string | null;
  /** Último instante con actividad técnica registrada en el historial. */
  ultima_actividad_at: string | null;
  /** Falso si algún tramo no tiene técnico atribuible (histórico anterior al snapshot). */
  atribucion_confiable: boolean;
};

type Evento = { ts: number; de: string | null; a: string | null };

function ms(iso: string | null | undefined): number {
  if (typeof iso !== "string" || !iso.trim()) return Number.NaN;
  return Date.parse(iso);
}

function leerReasignacion(row: SegmentoHistorial): Evento | null {
  const meta = row.metadata;
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (m.tipo !== "reasignacion_tecnico") return null;
  const ts = ms(row.entered_at);
  if (!Number.isFinite(ts)) return null;
  return {
    ts,
    de: typeof m.de === "string" ? m.de : null,
    a: typeof m.a === "string" ? m.a : null,
  };
}

function esEventoPuntual(row: SegmentoHistorial): boolean {
  // Reasignaciones y cambios de sub-etapa: `estado_*` en null, entrada = salida.
  return row.estado_nuevo_id == null;
}

/**
 * Dueño del trabajo en un instante, según la línea de reasignaciones.
 * `undefined` = la línea no dice nada y hay que caer al snapshot del segmento.
 */
function duenoEn(eventos: Evento[], ts: number): string | null | undefined {
  if (eventos.length === 0) return undefined;
  if (ts < eventos[0].ts) return eventos[0].de;
  let actual: string | null = eventos[0].a;
  for (const e of eventos) {
    if (e.ts <= ts) actual = e.a;
    else break;
  }
  return actual;
}

/** Cortes de la línea de tiempo dentro de `[desde, hasta)`, en orden. */
function tramos(eventos: Evento[], desde: number, hasta: number): [number, number][] {
  const cortes = [desde, ...eventos.map((e) => e.ts).filter((t) => t > desde && t < hasta), hasta];
  const out: [number, number][] = [];
  for (let i = 0; i < cortes.length - 1; i++) {
    if (cortes[i + 1] > cortes[i]) out.push([cortes[i], cortes[i + 1]]);
  }
  return out;
}

/**
 * SLV técnico de un proyecto a partir de sus filas de historial.
 *
 * @param filas          Historial COMPLETO del proyecto (segmentos y eventos puntuales).
 * @param esEstadoTecnico ¿Ese `estado_id` es de responsabilidad técnica?
 * @param atMs           Fecha de corte: los segmentos abiertos se miden hasta acá.
 */
export function slvTecnicoDeProyecto(
  proyectoId: string,
  filas: SegmentoHistorial[],
  esEstadoTecnico: (estadoId: string) => boolean,
  atMs: number = Date.now()
): SlvProyecto {
  const eventos: Evento[] = [];
  const segmentos: SegmentoHistorial[] = [];
  for (const f of filas) {
    const ev = leerReasignacion(f);
    if (ev) eventos.push(ev);
    if (!esEventoPuntual(f)) segmentos.push(f);
  }
  eventos.sort((a, b) => a.ts - b.ts);

  const porTecnico = new Map<string, number>();
  let total = 0;
  let ultima = Number.NEGATIVE_INFINITY;
  let confiable = true;

  for (const s of segmentos) {
    const estadoId = s.estado_nuevo_id;
    if (!estadoId || !esEstadoTecnico(estadoId)) continue;
    const desde = ms(s.entered_at);
    if (!Number.isFinite(desde) || desde > atMs) continue;
    const salida = ms(s.exited_at);
    const hasta = Number.isFinite(salida) ? Math.min(salida, atMs) : atMs;
    if (hasta <= desde) continue;

    if (Number.isFinite(salida)) ultima = Math.max(ultima, salida);
    else ultima = Math.max(ultima, desde);

    for (const [a, b] of tramos(eventos, desde, hasta)) {
      const trabajado = msLaborables(new Date(a).toISOString(), new Date(b).toISOString()) ?? 0;
      if (trabajado <= 0) continue;
      total += trabajado;
      const dueno = duenoEn(eventos, a);
      const tid = dueno === undefined ? s.responsable_tecnico_id : dueno;
      if (!tid) {
        confiable = false;
        continue;
      }
      porTecnico.set(tid, (porTecnico.get(tid) ?? 0) + trabajado);
    }
  }

  let principal: string | null = null;
  let mejor = -1;
  for (const [tid, v] of porTecnico) {
    if (v > mejor) {
      mejor = v;
      principal = tid;
    }
  }

  return {
    proyecto_id: proyectoId,
    total_ms: total,
    por_tecnico: porTecnico,
    tecnico_principal_id: principal,
    ultima_actividad_at: Number.isFinite(ultima) ? new Date(ultima).toISOString() : null,
    atribucion_confiable: confiable,
  };
}

/** Agrupa el historial por proyecto en una sola pasada (evita un filter por proyecto). */
export function agruparHistorial(filas: SegmentoHistorial[]): Map<string, SegmentoHistorial[]> {
  const out = new Map<string, SegmentoHistorial[]>();
  for (const f of filas) {
    const arr = out.get(f.proyecto_id);
    if (arr) arr.push(f);
    else out.set(f.proyecto_id, [f]);
  }
  return out;
}
