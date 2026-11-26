import { ctxV2, enTransaccion, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { COLS, crearProducto, listarPaginado } from "@/lib/erp2/productos";

export const runtime = "nodejs";

/**
 * GET ?paginado=1&pagina&por_pagina&q&categoria&inactivos=1 → { rows, total } (pantalla Productos).
 * GET (sin paginado) → { productos } activos, para buscadores.
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const sp = new URL(request.url).searchParams;
    if (sp.get("paginado") === "1") {
      const tipoSp = sp.get("tipo") ?? "";
      return ok(
        await listarPaginado(c.pool, c.empresaId, {
          pagina: Math.max(1, Number(sp.get("pagina")) || 1),
          porPagina: Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25)),
          q: (sp.get("q") ?? "").trim().slice(0, 200),
          categoria: sp.get("categoria") ?? "",
          inactivos: sp.get("inactivos") === "1",
          tipo: ["reventa", "menu", "materia_prima", "stock", "vendible"].includes(tipoSp) ? tipoSp : null,
        })
      );
    }
    const { rows } = await c.pool.query(
      `SELECT ${COLS} FROM neura.productos p WHERE p.empresa_id = $1::uuid AND COALESCE(p.activo, true) ORDER BY lower(p.nombre) LIMIT 1000`,
      [c.empresaId]
    );
    return ok({ productos: rows });
  } catch (err) {
    return fallo(err, "GET /productos");
  }
}

/** Alta. El stock inicial, si viene, queda como ajuste AJ- (inventario inicial) en su depósito. */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos del producto");
    const id = await enTransaccion(c.pool, (t) => crearProducto(t, { empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre }, b));
    return ok({ id }, 201);
  } catch (err) {
    return fallo(err, "POST /productos");
  }
}
