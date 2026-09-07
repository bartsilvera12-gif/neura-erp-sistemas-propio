import "server-only";

import { msLaborables } from "@/lib/proyectos/reloj-laboral";

export type HistorialRow = {
  entered_at: string;
  exited_at: string | null;
  /**
   * Duración de CALENDARIO que quedó guardada al cerrar el segmento. Ya no se
   * usa para el SLA —ver abajo— pero sigue en el tipo porque es lo que trae la
   * consulta y lo que muestra el historial crudo.
   */
  duration_seconds: number | null;
  tipo_sla_snapshot: string | null;
  estado_nuevo_id: string;
};

export type SlaTotales = {
  segundos_totales_proyecto: number;
  segundos_interno: number;
  segundos_cliente: number;
  segundos_pausado: number;
  segundos_abierto_actual: number;
  tipo_abierto: string | null;
};

export function computeSlaTotales(
  rows: HistorialRow[],
  nowMs: number = Date.now()
): SlaTotales {
  let interno = 0;
  let cliente = 0;
  let pausado = 0;
  let abierto = 0;
  let tipoAbierto: string | null = null;
  let total = 0;

  const nowIso = new Date(nowMs).toISOString();

  for (const r of rows) {
    const tipo = (r.tipo_sla_snapshot ?? "interno").trim();
    // Se recalcula sobre el horario de trabajo en vez de usar
    // `duration_seconds`, que es calendario. Un segmento abierto el viernes a
    // las 17 y cerrado el lunes a las 8 son 63 h corridas y CERO de trabajo:
    // contarlas como SLA castiga al equipo por el fin de semana.
    const labor = msLaborables(r.entered_at, r.exited_at ?? nowIso);
    const sec = labor != null ? Math.floor(labor / 1000) : 0;
    if (r.exited_at == null && r.entered_at) {
      abierto = sec;
      tipoAbierto = tipo;
    }
    total += sec;

    if (tipo === "final") continue;
    if (tipo === "interno") interno += sec;
    else if (tipo === "cliente") cliente += sec;
    else if (tipo === "pausado") pausado += sec;
  }

  return {
    segundos_totales_proyecto: total,
    segundos_interno: interno,
    segundos_cliente: cliente,
    segundos_pausado: pausado,
    segundos_abierto_actual: abierto,
    tipo_abierto: tipoAbierto,
  };
}
