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
 * `mios=1` acota a la cartera del PM que está mirando, y el id sale de la
 * SESIÓN, nunca del query string: si viniera por parámetro, cualquiera podría
 * pedir la cartera de otro PM cambiando la URL.
 */
export function leerFiltros(
  request: Request,
  ctx: { usuarioId: string; puedeVerTodo: boolean }
): Filtros {
  const sp = new URL(request.url).searchParams;
  const mios = sp.get("mios") === "1";
  return {
    desde: fecha(sp, "desde"),
    hasta: fecha(sp, "hasta"),
    tipoId: texto(sp, "tipo_id"),
    estadoId: texto(sp, "estado_id"),
    tecnicoId: texto(sp, "responsable_tecnico_id"),
    pmId: mios || !ctx.puedeVerTodo ? ctx.usuarioId : null,
  };
}
