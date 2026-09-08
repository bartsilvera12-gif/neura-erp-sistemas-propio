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
 * `pm_id` elige la cartera a mirar. Tres valores posibles, y los tres
 * significan cosas distintas:
 *   · ausente      — todavía no eligió: se usa `pmPorDefecto` (su propia
 *                    cartera), para que al entrar vea la suya y no un promedio.
 *   · "todas"      — eligió ver todas, dicho explícitamente.
 *   · un id        — esa cartera.
 *
 * Sin el "todas" explícito no habría forma de distinguir "quiero ver todo" de
 * "todavía no elegí", y una de las dos quedaría sin poder expresarse.
 *
 * Quién puede elegir lo decide el SERVIDOR: a quien no tiene permiso se le
 * fuerza la propia, pida lo que pida — si el id del query mandara, bastaría
 * cambiar la URL para ver la cartera ajena.
 */
export function leerFiltros(
  request: Request,
  ctx: { usuarioId: string; puedeVerTodo: boolean; pmPorDefecto?: string | null }
): Filtros {
  const sp = new URL(request.url).searchParams;
  const crudo = texto(sp, "pm_id");
  const pedido =
    crudo === null ? (ctx.pmPorDefecto ?? null) : crudo === "todas" ? null : crudo;
  return {
    desde: fecha(sp, "desde"),
    hasta: fecha(sp, "hasta"),
    tipoId: texto(sp, "tipo_id"),
    estadoId: texto(sp, "estado_id"),
    tecnicoId: texto(sp, "responsable_tecnico_id"),
    pmId: ctx.puedeVerTodo ? pedido : ctx.usuarioId,
  };
}
