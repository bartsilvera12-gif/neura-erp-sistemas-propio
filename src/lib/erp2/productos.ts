/**
 * Productos para las pantallas del 2.0, sobre `neura.productos`.
 *
 * El stock nunca se escribe acá: el alta con stock inicial lo registra como ajuste de inventario
 * inicial (AJ-) con `inv_registrar_ajuste`, en la misma transacción que crea el producto.
 */
import type { Pool, PoolClient } from "pg";
import { ErrorV2, esUuid } from "./server";

/**
 * Columnas de Neura con los nombres del 2.0. Lo que Neura no tiene (precios por cantidad, IVA por
 * producto, tipo, lotes) sale con el valor de siempre del 2.0: la pantalla lo muestra, no se guarda.
 */
export const COLS = `p.id, p.nombre, p.sku, p.codigo_barras, p.categoria_principal_id, p.proveedor_principal_id,
  COALESCE(p.costo_promedio, 0)::float AS costo_promedio, COALESCE(p.precio_venta, 0)::float AS precio_venta,
  NULL::float AS precio_mayorista, NULL::float AS precio_distribuidor,
  NULL::float AS mayorista_desde, NULL::float AS distribuidor_desde,
  0::float AS descuento_pct, COALESCE(p.stock_actual, 0)::float AS stock_actual,
  COALESCE(p.stock_minimo, 0)::float AS stock_minimo, COALESCE(NULLIF(p.unidad_medida, ''), 'Unidad') AS unidad_medida,
  '10%'::text AS tipo_iva, 'reventa'::text AS tipo_producto, true AS controla_stock, false AS controla_lotes, true AS es_vendible,
  COALESCE(p.activo, true) AS activo, p.imagen_url`;

/** Lo único que se escribe en `neura.productos` (sus columnas de siempre). */
const COLUMNAS_NEURA = new Set([
  "nombre", "sku", "codigo_barras", "unidad_medida", "imagen_url", "categoria_principal_id",
  "proveedor_principal_id", "costo_promedio", "precio_venta", "stock_minimo", "activo",
]);

export interface FiltrosLista {
  pagina: number;
  porPagina: number;
  q: string;
  categoria: string;
  inactivos: boolean;
  tipo: string | null;
}

export async function listarPaginado(pool: Pool, empresaId: string, f: FiltrosLista) {
  const where: string[] = ["p.empresa_id = $1::uuid"];
  const args: unknown[] = [empresaId];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  // "Ver inactivos": muestra también los desactivados (como el 2.0).
  if (!f.inactivos) where.push("COALESCE(p.activo, true)");
  if (f.categoria === "__sin__") where.push("p.categoria_principal_id IS NULL");
  else if (esUuid(f.categoria)) {
    const a = arg(f.categoria);
    where.push(`(p.categoria_principal_id = ${a}::uuid OR p.categoria_principal_id IN
      (SELECT id FROM neura.categorias_productos WHERE parent_id = ${a}::uuid))`);
  }
  // Neura no tiene tipos de producto: todos son "reventa".
  if (f.tipo === "menu" || f.tipo === "materia_prima") where.push("false");
  if (f.q) {
    // Cada palabra tiene que aparecer (en cualquier orden).
    const palabras = f.q.split(/\s+/).filter(Boolean).slice(0, 8);
    for (const w of palabras) {
      const a = arg(`%${w}%`);
      where.push(`(p.nombre ILIKE ${a} OR p.sku ILIKE ${a} OR COALESCE(p.codigo_barras, '') ILIKE ${a})`);
    }
  }
  const w = where.join(" AND ");
  const { rows: tot } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM neura.productos p WHERE ${w}`, args);
  // SKU o código de barras exacto va primero (el parámetro se agrega después del conteo, que no lo usa).
  const orden = f.q
    ? (() => {
        const q = arg(f.q);
        return `(lower(p.sku) = lower(${q}::text) OR p.codigo_barras = ${q}::text) DESC, lower(p.nombre)`;
      })()
    : "lower(p.nombre)";
  const limite = arg(f.porPagina);
  const desde = arg((f.pagina - 1) * f.porPagina);
  const { rows } = await pool.query(
    `SELECT ${COLS},
            COALESCE((SELECT json_agg(json_build_object('d', s.ubicacion_id, 'c', s.stock_actual::float))
                        FROM neura.inventario_stock_ubicacion s
                       WHERE s.producto_id = p.id AND s.empresa_id = p.empresa_id AND s.stock_actual <> 0), '[]') AS stock_depositos
       FROM neura.productos p
      WHERE ${w}
      ORDER BY ${orden}
      LIMIT ${limite} OFFSET ${desde}`,
    args
  );
  return { rows, total: tot[0]?.n ?? 0 };
}

export async function unProducto(pool: Pool | PoolClient, empresaId: string, id: string) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM neura.productos p WHERE p.id = $1::uuid AND p.empresa_id = $2::uuid`, [id, empresaId]);
  if (!rows[0]) throw new ErrorV2("Producto no encontrado", 404);
  return { ...rows[0], en_menu_qr: false, estacion_id: null };
}

const NUM = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Valida y normaliza los campos editables (los mismos que manda el formulario del 2.0). */
export function camposProducto(b: Record<string, unknown>, alta: boolean) {
  const out: Record<string, unknown> = {};
  const str = (k: string, max: number) => {
    if (b[k] === undefined) return;
    const v = b[k] === null ? null : String(b[k]).trim().slice(0, max);
    out[k] = v === "" ? null : v;
  };
  str("nombre", 200);
  str("sku", 60);
  str("codigo_barras", 60);
  str("unidad_medida", 30);
  str("imagen_url", 1000);
  for (const k of ["categoria_principal_id", "proveedor_principal_id"]) {
    if (b[k] === undefined) continue;
    out[k] = esUuid(b[k]) ? b[k] : null;
  }
  for (const k of ["costo_promedio", "precio_venta", "stock_minimo", "descuento_pct"]) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0) throw new ErrorV2(`Valor inválido en ${k.replace("_", " ")}`);
    if (n > 1e10) throw new ErrorV2("El número es demasiado alto: revisalo");
    out[k] = n;
  }
  for (const k of ["precio_mayorista", "precio_distribuidor", "mayorista_desde", "distribuidor_desde"]) {
    if (b[k] === undefined) continue;
    const n = NUM(b[k]);
    if (n !== null && (!Number.isFinite(n) || n < 0)) throw new ErrorV2(`Valor inválido en ${k.replace("_", " ")}`);
    out[k] = n;
  }
  if (out.descuento_pct !== undefined && Number(out.descuento_pct) > 100) throw new ErrorV2("El descuento no puede pasar el 100 %");
  if (b.tipo_iva !== undefined) {
    if (!["EXENTA", "5%", "10%"].includes(String(b.tipo_iva))) throw new ErrorV2("IVA inválido");
    out.tipo_iva = b.tipo_iva;
  }
  if (b.tipo_producto !== undefined) {
    if (!["reventa", "menu", "materia_prima"].includes(String(b.tipo_producto))) throw new ErrorV2("Tipo inválido");
    out.tipo_producto = b.tipo_producto;
  }
  for (const k of ["controla_stock", "controla_lotes", "es_vendible", "activo"]) {
    if (b[k] === undefined) continue;
    out[k] = Boolean(b[k]);
  }
  for (const k of Object.keys(out)) if (!COLUMNAS_NEURA.has(k)) delete out[k];
  if (alta) {
    if (!out.nombre) throw new ErrorV2("El nombre es obligatorio");
    if (!out.sku) throw new ErrorV2("El SKU es obligatorio");
  } else {
    if (out.nombre === null) throw new ErrorV2("El nombre es obligatorio");
    if (out.sku === null) throw new ErrorV2("El SKU es obligatorio");
  }
  return out;
}

/** Alta: producto con stock 0 y, si viene, el stock inicial como ajuste AJ- en su depósito. */
export async function crearProducto(
  c: PoolClient,
  quien: { empresaId: string; usuarioId: string; nombre: string },
  b: Record<string, unknown>
) {
  const campos = camposProducto(b, true);
  const ini = b.stock_inicial as { cantidad?: unknown; deposito_id?: unknown } | undefined;
  const cols = Object.keys(campos);
  const vals = Object.values(campos);
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO neura.productos (empresa_id, stock_actual, metodo_valuacion, ${cols.join(", ")})
     VALUES ($1::uuid, 0, 'CPP', ${cols.map((_, i) => `$${i + 2}`).join(", ")})
     RETURNING id`,
    [quien.empresaId, ...vals]
  );
  const id = rows[0].id;
  const cant = Number(ini?.cantidad ?? 0);
  if (ini && cant > 0) {
    if (!esUuid(ini.deposito_id)) throw new ErrorV2("Elegí el depósito del stock inicial");
    await c.query(`SELECT neura.inv_registrar_ajuste($1::uuid, $2::uuid, $3, $4::jsonb)`, [
      quien.empresaId,
      quien.usuarioId,
      quien.nombre,
      JSON.stringify({
        tipo: "ajuste",
        motivo: "inventario_inicial",
        ubicacion_id: ini.deposito_id,
        detalle: "Stock inicial al crear el producto",
        items: [{ producto_id: id, modo: "diferencia", cantidad: cant }],
      }),
    ]);
  }
  return id;
}

/** Se puede borrar solo si nunca se usó: sin compras, ventas, órdenes ni más movimientos que el inicial. */
export async function eliminarProducto(c: PoolClient, empresaId: string, id: string) {
  const usado = await c.query<{ donde: string }>(
    `SELECT 'compras' AS donde WHERE EXISTS (SELECT 1 FROM neura.compra_items WHERE producto_id = $1::uuid)
        OR EXISTS (SELECT 1 FROM neura.compras WHERE producto_id = $1::uuid)
     UNION ALL SELECT 'ventas' WHERE EXISTS (SELECT 1 FROM neura.ventas_items WHERE producto_id = $1::uuid)
     UNION ALL SELECT 'órdenes de compra' WHERE EXISTS (SELECT 1 FROM neura.orden_compra_items WHERE producto_id = $1::uuid)
     UNION ALL SELECT 'traslados' WHERE EXISTS (SELECT 1 FROM neura.inventario_traslados_items WHERE producto_id = $1::uuid)
     UNION ALL SELECT 'movimientos' WHERE EXISTS (SELECT 1 FROM neura.movimientos_inventario
                                                   WHERE producto_id = $1::uuid
                                                     AND origen NOT IN ('inventario_inicial')
                                                     AND NOT (origen = 'ajuste' AND documento_id IN
                                                       (SELECT ajuste_id FROM neura.inventario_ajustes_items i
                                                          JOIN neura.inventario_ajustes a ON a.id = i.ajuste_id
                                                         WHERE i.producto_id = $1::uuid AND a.motivo = 'inventario_inicial')))`,
    [id]
  );
  if (usado.rows.length > 0) {
    throw new ErrorV2(`No se puede eliminar: tiene ${usado.rows.map((r) => r.donde).join(", ")}. Desactivalo en su lugar.`);
  }
  // Lo único que tiene es su stock inicial: se borra todo junto (sin pasar por el trigger de stock).
  await c.query(`SELECT set_config('neura.inv_mover', '1', true)`);
  await c.query(`DELETE FROM neura.movimientos_inventario WHERE producto_id = $1::uuid`, [id]);
  await c.query(
    `DELETE FROM neura.inventario_ajustes a USING neura.inventario_ajustes_items i
      WHERE i.ajuste_id = a.id AND i.producto_id = $1::uuid AND a.motivo = 'inventario_inicial'
        AND NOT EXISTS (SELECT 1 FROM neura.inventario_ajustes_items o WHERE o.ajuste_id = a.id AND o.producto_id <> $1::uuid)`,
    [id]
  );
  await c.query(`DELETE FROM neura.inventario_ajustes_items WHERE producto_id = $1::uuid`, [id]);
  await c.query(`DELETE FROM neura.inventario_stock_ubicacion WHERE producto_id = $1::uuid`, [id]);
  await c.query(`DELETE FROM neura.producto_categorias WHERE producto_id = $1::uuid`, [id]);
  await c.query(`DELETE FROM neura.proveedor_productos WHERE producto_id = $1::uuid`, [id]);
  const { rowCount } = await c.query(`DELETE FROM neura.productos WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
  if (!rowCount) throw new ErrorV2("Producto no encontrado", 404);
}
