/**
 * Clientes con la forma del 2.0 (buscador de la caja) sobre `neura.clientes`.
 * El RUC que se muestra es el de la factura (`ruc_factura`, o `ruc`), igual que SIFEN.
 * El alta crea el cliente mínimo, como la "Nueva factura" de Caja (`/api/caja/cliente-por-ruc`).
 */
import type { Pool } from "pg";
import { ErrorV2, esUuid } from "./server";

const COLS = `c.id, COALESCE(NULLIF(c.razon_social, ''), NULLIF(c.empresa, ''), NULLIF(c.nombre, ''), c.nombre_contacto) AS nombre,
  c.documento, CASE WHEN c.tipo_cliente = 'persona' THEN 'persona' ELSE 'empresa' END AS tipo_cliente, c.razon_social,
  COALESCE(NULLIF(c.ruc_factura, ''), NULLIF(c.ruc, '')) AS ruc, c.telefono, c.email, c.direccion, c.ciudad,
  CASE WHEN upper(COALESCE(c.condicion_pago, '')) LIKE '%D_AS%' OR upper(COALESCE(c.condicion_pago, '')) = 'CREDITO' THEN 'credito' ELSE 'contado' END AS condicion_pago,
  NULLIF(substring(COALESCE(c.condicion_pago, '') from '[0-9]+'), '')::int AS plazo_dias, 0 AS limite_credito, c.origen, c.notas,
  (COALESCE(c.estado, 'activo') <> 'inactivo') AS activo, c.vendedor_usuario_id, c.created_at AS creado_at`;

export async function buscarClientes(pool: Pool, empresaId: string, q: string, limite: number) {
  const args: unknown[] = [empresaId, limite];
  let filtro = "";
  if (q) {
    args.push(`%${q}%`);
    filtro = `AND (c.nombre ILIKE $3 OR c.razon_social ILIKE $3 OR c.empresa ILIKE $3 OR c.nombre_contacto ILIKE $3
                   OR c.ruc ILIKE $3 OR c.ruc_factura ILIKE $3 OR c.documento ILIKE $3)`;
  }
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM neura.clientes c
      WHERE c.empresa_id = $1::uuid AND c.deleted_at IS NULL ${filtro}
      ORDER BY ${q ? "lower(COALESCE(NULLIF(c.razon_social, ''), c.nombre))" : "c.created_at DESC"} LIMIT $2`,
    args
  );
  return rows;
}

export async function unCliente(pool: Pool, empresaId: string, id: string) {
  if (!esUuid(id)) throw new ErrorV2("Cliente no encontrado", 404);
  const { rows } = await pool.query(`SELECT ${COLS} FROM neura.clientes c WHERE c.id = $1::uuid AND c.empresa_id = $2::uuid AND c.deleted_at IS NULL`, [id, empresaId]);
  if (!rows[0]) throw new ErrorV2("Cliente no encontrado", 404);
  return rows[0];
}

export async function crearCliente(pool: Pool, empresaId: string, authUserId: string | null, b: Record<string, unknown>) {
  const nombre = String(b.nombre ?? "").trim().slice(0, 200);
  if (!nombre) throw new ErrorV2("Escribí el nombre del cliente");
  const documento = String(b.documento ?? "").trim().slice(0, 30) || null;
  const esRuc = !!documento && /^\d{3,}-\d$/.test(documento);
  if (documento) {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(razon_social, ''), nombre) AS nombre FROM neura.clientes
        WHERE empresa_id = $1::uuid AND deleted_at IS NULL AND (ruc_factura = $2 OR ruc = $2 OR documento = $2) LIMIT 1`,
      [empresaId, documento]
    );
    if (rows[0]) throw new ErrorV2(`Ya hay un cliente con ese documento: ${rows[0].nombre}`);
  }
  const persona = b.tipo_cliente === "persona";
  const { rows } = await pool.query(
    `INSERT INTO neura.clientes (empresa_id, tipo_cliente, nombre, nombre_contacto, razon_social, empresa, ruc, ruc_factura, documento,
            telefono, condicion_pago, created_by_user_id, origen, estado, moneda_preferida)
     VALUES ($1::uuid, $2, $3, $3, $4, $5, $6, $6, $7, $8, $9, $10::uuid, 'CAJA', 'activo', 'GS') RETURNING id`,
    [empresaId, persona ? "persona" : "empresa", nombre, esRuc ? nombre : null, persona ? null : nombre, esRuc ? documento : null,
     esRuc ? null : documento, String(b.telefono ?? "").trim().slice(0, 40) || null, b.condicion_pago === "credito" ? "30 DÍAS" : "CONTADO", authUserId]
  );
  return unCliente(pool, empresaId, rows[0].id);
}
