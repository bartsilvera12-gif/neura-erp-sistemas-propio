import "server-only";

import type { Filtros } from "./shared";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function texto(sp: URLSearchParams, key: string): string | null {
  const v = sp.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function fecha(sp: URLSearchParams, key: string): string | null {
  const v = texto(sp, key);
  return v && ES_FECHA.test(v) ? v : null;
}

/**
 * Filtros de pantalla.
 *
 * `pm_id` elige la cartera a mirar; vacío = todas. Quién puede elegir lo decide
 * el SERVIDOR: sólo quien tiene permiso de ver todo (administración) puede
 * pedir la cartera de otra persona. A un PM se le fuerza la propia, pida lo que
 * pida — si el id del query mandara, bastaría cambiar la URL para ver la
 * cartera ajena.
 */
export function leerFiltros(
  request: Request,
  ctx: { usuarioId: string; puedeVerTodo: boolean }
): Filtros {
  const sp = new URL(request.url).searchParams;
  const pedido = texto(sp, "pm_id");
  return {
    desde: fecha(sp, "desde"),
    hasta: fecha(sp, "hasta"),
    tipoId: texto(sp, "tipo_id"),
    estadoId: texto(sp, "estado_id"),
    tecnicoId: texto(sp, "responsable_tecnico_id"),
    pmId: ctx.puedeVerTodo ? pedido : ctx.usuarioId,
  };
}
