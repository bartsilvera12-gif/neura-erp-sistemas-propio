/**
 * Proveedores con la forma del ERP 2.0 sobre `neura.proveedores` y sus rubros
 * (`proveedor_categorias` + `proveedor_categoria_rel`). Ciudad y teléfono del contacto no
 * existen en Neura: se muestran vacíos y no se guardan.
 */
import type { Pool, PoolClient } from "pg";
import { enTransaccion, ErrorV2, esUuid } from "./server";

export async function listarProveedores(pool: Pool, empresaId: string) {
  const { rows } = await pool.query(
    `SELECT p.id, p.nombre, p.nombre_comercial, p.ruc, p.telefono, p.email, p.direccion, NULL::text AS ciudad, p.contacto,
            NULL::text AS contacto_telefono, CASE WHEN p.condicion_pago = 'credito' THEN 'credito' ELSE 'contado' END AS condicion_pago,
            p.plazo_pago_dias, CASE WHEN p.moneda_preferida = 'USD' THEN 'USD' ELSE 'GS' END AS moneda, p.observaciones,
            (COALESCE(p.estado, 'activo') = 'activo') AS activo, p.created_at,
            COALESCE((SELECT json_agg(json_build_object('id', k.id, 'nombre', k.nombre, 'activo', COALESCE(k.activo, true)) ORDER BY k.nombre)
                        FROM neura.proveedor_categoria_rel r JOIN neura.proveedor_categorias k ON k.id = r.categoria_id
                       WHERE r.proveedor_id = p.id), '[]') AS categorias,
            (SELECT count(*) FROM neura.compras c WHERE c.proveedor_id = p.id AND COALESCE(c.estado, '') <> 'anulada')::int AS compras,
            (SELECT max(c.fecha) FROM neura.compras c WHERE c.proveedor_id = p.id) AS ultima_compra
       FROM neura.proveedores p
      WHERE p.empresa_id = $1::uuid
      ORDER BY lower(COALESCE(NULLIF(p.nombre_comercial, ''), p.nombre))`,
    [empresaId]
  );
  return rows;
}

export async function categoriasProveedor(pool: Pool, empresaId: string) {
  const { rows } = await pool.query(
    `SELECT id, nombre, COALESCE(activo, true) AS activo FROM neura.proveedor_categorias WHERE empresa_id = $1::uuid ORDER BY nombre`,
    [empresaId]
  );
  return rows;
}

const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function campos(b: Record<string, unknown>, alta: boolean) {
  const out: Record<string, unknown> = {};
  if (b.nombre !== undefined || alta) {
    const n = txt(b.nombre, 200);
    if (!n) throw new ErrorV2("Escribí la razón social del proveedor");
    out.nombre = n;
    out.razon_social = n;
  }
  for (const [k, max] of [["nombre_comercial", 200], ["ruc", 30], ["telefono", 40], ["email", 120], ["direccion", 300], ["contacto", 120], ["observaciones", 1000]] as const) {
    if (b[k] !== undefined) out[k] = txt(b[k], max);
  }
  if (b.condicion_pago !== undefined) out.condicion_pago = b.condicion_pago === "credito" ? "credito" : "contado";
  if (b.plazo_pago_dias !== undefined) {
    const n = Number(b.plazo_pago_dias);
    out.plazo_pago_dias = Number.isFinite(n) && n > 0 ? Math.min(365, Math.round(n)) : null;
  }
  if (b.moneda !== undefined) out.moneda_preferida = b.moneda === "USD" ? "USD" : "GS";
  if (typeof b.activo === "boolean") out.estado = b.activo ? "activo" : "inactivo";
  return out;
}

/** Rubros: los elegidos por id más los nuevos por nombre (se crean si no existen). */
async function guardarRubros(c: PoolClient, empresaId: string, proveedorId: string, b: Record<string, unknown>) {
  if (b.categoria_ids === undefined && b.categorias_nuevas === undefined) return;
  const ids = (Array.isArray(b.categoria_ids) ? b.categoria_ids : []).filter(esUuid) as string[];
  for (const n of (Array.isArray(b.categorias_nuevas) ? b.categorias_nuevas : []) as unknown[]) {
    const nombre = txt(n, 80);
    if (!nombre) continue;
    const { rows: ya } = await c.query(`SELECT id FROM neura.proveedor_categorias WHERE empresa_id = $1::uuid AND lower(nombre) = lower($2)`, [empresaId, nombre]);
    if (ya[0]) ids.push(ya[0].id);
    else {
      const { rows } = await c.query(`INSERT INTO neura.proveedor_categorias (empresa_id, nombre, activo) VALUES ($1::uuid, $2, true) RETURNING id`, [empresaId, nombre]);
      ids.push(rows[0].id);
    }
  }
  await c.query(`DELETE FROM neura.proveedor_categoria_rel WHERE proveedor_id = $1::uuid`, [proveedorId]);
  for (const id of [...new Set(ids)]) {
    await c.query(`INSERT INTO neura.proveedor_categoria_rel (empresa_id, proveedor_id, categoria_id) VALUES ($1::uuid, $2::uuid, $3::uuid)`, [empresaId, proveedorId, id]);
  }
}

export async function crearProveedor(pool: Pool, empresaId: string, b: Record<string, unknown>) {
  const f = campos(b, true);
  if (f.ruc) {
    const { rows } = await pool.query(`SELECT nombre FROM neura.proveedores WHERE empresa_id = $1::uuid AND ruc = $2`, [empresaId, f.ruc]);
    if (rows[0]) throw new ErrorV2(`Ya hay un proveedor con ese RUC: ${rows[0].nombre}`);
  }
  return enTransaccion(pool, async (c) => {
    const cols = Object.keys(f);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO neura.proveedores (empresa_id, estado, ${cols.join(", ")}) VALUES ($1::uuid, 'activo', ${cols.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
      [empresaId, ...Object.values(f)]
    );
    await guardarRubros(c, empresaId, rows[0].id, b);
    return { id: rows[0].id };
  });
}

export async function editarProveedor(pool: Pool, empresaId: string, id: string, b: Record<string, unknown>) {
  const f = campos(b, false);
  return enTransaccion(pool, async (c) => {
    const cols = Object.keys(f);
    if (cols.length) {
      const { rowCount } = await c.query(
        `UPDATE neura.proveedores SET ${cols.map((k, i) => `${k} = $${i + 3}`).join(", ")}, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [id, empresaId, ...Object.values(f)]
      );
      if (!rowCount) throw new ErrorV2("Proveedor no encontrado", 404);
    }
    await guardarRubros(c, empresaId, id, b);
    return { id };
  });
}

/** Solo si no tiene compras, órdenes ni productos asociados (si no: desactivarlo). */
export async function eliminarProveedor(pool: Pool, empresaId: string, id: string) {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM neura.compras WHERE proveedor_id = $1::uuid)::int AS compras,
            (SELECT count(*) FROM neura.ordenes_compra WHERE proveedor_id = $1::uuid)::int AS ordenes,
            (SELECT count(*) FROM neura.productos WHERE proveedor_principal_id = $1::uuid)::int AS productos`,
    [id]
  );
  const u = rows[0];
  if (u.compras || u.ordenes || u.productos) {
    throw new ErrorV2("No se puede eliminar: tiene compras, órdenes o productos. Desactivalo en su lugar.");
  }
  return enTransaccion(pool, async (c) => {
    await c.query(`DELETE FROM neura.proveedor_categoria_rel WHERE proveedor_id = $1::uuid`, [id]);
    await c.query(`DELETE FROM neura.proveedor_productos WHERE proveedor_id = $1::uuid`, [id]);
    const { rowCount } = await c.query(`DELETE FROM neura.proveedores WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
    if (!rowCount) throw new ErrorV2("Proveedor no encontrado", 404);
    return { id };
  });
}
