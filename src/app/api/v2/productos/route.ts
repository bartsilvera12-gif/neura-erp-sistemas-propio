import { ctxV2, enTransaccion, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { COLS, crearProducto, listarPaginado } from "@/lib/erp2/productos";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { signProductoImagen } from "@/lib/inventario/imagen-storage";

export const runtime = "nodejs";

/** Firma la imagen del bucket privado para que la miniatura se vea en listas/buscador. */
async function firmarImagenes<T extends { imagen_url?: string | null; imagen_path?: string | null }>(rows: T[]): Promise<T[]> {
  const sb = createServiceRoleClient() as Parameters<typeof signProductoImagen>[0];
  const TOPE = 24; // solo las primeras visibles, para no encarecer la consulta
  return Promise.all(
    rows.map(async (r, i) => {
      if (r.imagen_url || !r.imagen_path || i >= TOPE) return r;
      const url = await signProductoImagen(sb, r.imagen_path, 3600).catch(() => null);
      return url ? { ...r, imagen_url: url } : r;
    })
  );
}

/**
 * GET ?paginado=1&pagina&por_pagina&q&categoria&inactivos=1 → { rows, total } (pantalla Productos).
 * GET (sin paginado) → { productos } activos, para buscadores.
 */
export async function GET(request: Request) {
  try {
    const sp = new URL(request.url).searchParams;
    // Catálogo de la caja: los activos con precio, con el stock del depósito de la caja.
    if (sp.get("pos") === "1") {
      const c = await ctxV2(request, "ventas");
      const dep = sp.get("deposito") ?? "";
      if (!esUuid(dep)) throw new ErrorV2("Falta el depósito de la caja");
      const { rows } = await c.pool.query(
        `SELECT ${COLS.replace("COALESCE(p.stock_actual, 0)::float AS stock_actual", "COALESCE(s.stock_actual, 0)::float AS stock_actual")}
           FROM neura.productos p
           LEFT JOIN neura.inventario_stock_ubicacion s ON s.producto_id = p.id AND s.ubicacion_id = $2::uuid AND s.empresa_id = p.empresa_id
          WHERE p.empresa_id = $1::uuid AND COALESCE(p.activo, true)
          ORDER BY lower(p.nombre) LIMIT 3000`,
        [c.empresaId, dep]
      );
      return ok(rows);
    }
    const c = await ctxV2(request, "inventario");
    if (sp.get("paginado") === "1") {
      const tipoSp = sp.get("tipo") ?? "";
      const data = await listarPaginado(c.pool, c.empresaId, {
        pagina: Math.max(1, Number(sp.get("pagina")) || 1),
        porPagina: Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25)),
        q: (sp.get("q") ?? "").trim().slice(0, 200),
        categoria: sp.get("categoria") ?? "",
        inactivos: sp.get("inactivos") === "1",
        tipo: ["reventa", "menu", "materia_prima", "stock", "vendible"].includes(tipoSp) ? tipoSp : null,
      });
      return ok({ ...data, rows: await firmarImagenes(data.rows as Array<{ imagen_url?: string | null; imagen_path?: string | null }>) });
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
