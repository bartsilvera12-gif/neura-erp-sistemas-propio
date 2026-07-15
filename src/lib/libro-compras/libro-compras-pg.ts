import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Libro de Compras — unifica en un solo núcleo:
 *  A) Compras válidas (estado <> 'anulada').
 *  B) Gastos y Servicios confirmados (estado = 'confirmado', con datos fiscales).
 * Excluye borradores, anulados, históricos incompletos, órdenes y recepciones.
 * Solo lectura (no crea asientos ni toca inventario).
 */

export interface LibroCompraRow {
  origen_tipo: "compra" | "gasto";
  origen: string;
  fecha: string | null;
  proveedor: string | null;
  ruc: string | null;
  tipo_comprobante: string | null;
  timbrado: string | null;
  numero: string | null;
  condicion: string | null;
  exento: string | number;
  gravado5: string | number;
  iva5: string | number;
  gravado10: string | number;
  iva10: string | number;
  total: string | number;
  estado: string;
  proveedor_id: string | null;
}

export interface LibroTotals {
  exento: number;
  gravado5: number;
  iva5: number;
  gravado10: number;
  iva10: number;
  total: number;
  cantidad: number;
}

export interface LibroFilters {
  desde?: string | null;
  hasta?: string | null;
  proveedor_id?: string | null;
  origen?: "compra" | "gasto" | null;
  tipo_comprobante?: string | null;
  condicion?: string | null;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export async function listLibroCompras(schemaRaw: string, empresaId: string, f: LibroFilters = {}): Promise<LibroCompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tG = quoteSchemaTable(schema, "gastos");
  const tI = quoteSchemaTable(schema, "gasto_items");
  const tPr = quoteSchemaTable(schema, "proveedores");

  const params: unknown[] = [empresaId];
  const outer: string[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };

  if (f.desde) outer.push(`x.fecha >= ${add(f.desde)}::date`);
  if (f.hasta) outer.push(`x.fecha <= ${add(f.hasta)}::date`);
  if (f.proveedor_id) outer.push(`x.proveedor_id = ${add(f.proveedor_id)}::uuid`);
  if (f.origen) outer.push(`x.origen_tipo = ${add(f.origen)}`);
  if (f.tipo_comprobante) outer.push(`x.tipo_comprobante = ${add(f.tipo_comprobante)}`);
  if (f.condicion) outer.push(`x.condicion = ${add(f.condicion)}`);
  const outerWhere = outer.length ? `WHERE ${outer.join(" AND ")}` : "";

  const sql = `
    WITH unificado AS (
      SELECT 'compra'::text AS origen_tipo, 'Compra'::text AS origen,
             c.fecha::date AS fecha, c.proveedor_nombre AS proveedor, pr.ruc AS ruc,
             NULL::text AS tipo_comprobante, c.nro_timbrado AS timbrado, c.numero_control AS numero,
             c.tipo_pago AS condicion,
             CASE WHEN c.iva_tipo='exenta' THEN c.subtotal ELSE 0 END AS exento,
             CASE WHEN c.iva_tipo='5'      THEN c.subtotal ELSE 0 END AS gravado5,
             CASE WHEN c.iva_tipo='5'      THEN c.monto_iva ELSE 0 END AS iva5,
             CASE WHEN c.iva_tipo='10'     THEN c.subtotal ELSE 0 END AS gravado10,
             CASE WHEN c.iva_tipo='10'     THEN c.monto_iva ELSE 0 END AS iva10,
             c.total AS total, c.estado AS estado, c.proveedor_id AS proveedor_id
        FROM ${tC} c LEFT JOIN ${tPr} pr ON pr.id = c.proveedor_id
       WHERE c.empresa_id = $1::uuid AND COALESCE(c.estado,'') <> 'anulada'
             AND c.nro_timbrado IS NOT NULL AND btrim(c.nro_timbrado) <> ''
      UNION ALL
      SELECT 'gasto'::text, 'Gasto o Servicio'::text,
             COALESCE(g.fecha_comprobante, g.fecha)::date, pr.nombre, pr.ruc,
             g.tipo_comprobante, g.timbrado, g.numero, g.tipo_pago,
             COALESCE(SUM(CASE WHEN i.iva_tipo='exenta' THEN i.subtotal END),0),
             COALESCE(SUM(CASE WHEN i.iva_tipo='5'      THEN i.subtotal END),0),
             COALESCE(SUM(CASE WHEN i.iva_tipo='5'      THEN i.monto_iva END),0),
             COALESCE(SUM(CASE WHEN i.iva_tipo='10'     THEN i.subtotal END),0),
             COALESCE(SUM(CASE WHEN i.iva_tipo='10'     THEN i.monto_iva END),0),
             g.total, g.estado, g.proveedor_id
        FROM ${tG} g JOIN ${tPr} pr ON pr.id = g.proveedor_id
        LEFT JOIN ${tI} i ON i.gasto_id = g.id
       WHERE g.empresa_id = $1::uuid AND g.estado = 'confirmado'
       GROUP BY g.id, pr.nombre, pr.ruc, g.tipo_comprobante, g.timbrado, g.numero,
                g.tipo_pago, g.total, g.estado, g.proveedor_id, COALESCE(g.fecha_comprobante, g.fecha)
    )
    SELECT x.* FROM unificado x
    ${outerWhere}
    ORDER BY x.fecha DESC NULLS LAST, x.numero DESC`;

  const { rows } = await pool().query<LibroCompraRow>(sql, params);
  return rows;
}

export function computeTotals(rows: LibroCompraRow[]): LibroTotals {
  const t: LibroTotals = { exento: 0, gravado5: 0, iva5: 0, gravado10: 0, iva10: 0, total: 0, cantidad: rows.length };
  for (const r of rows) {
    t.exento += Number(r.exento) || 0;
    t.gravado5 += Number(r.gravado5) || 0;
    t.iva5 += Number(r.iva5) || 0;
    t.gravado10 += Number(r.gravado10) || 0;
    t.iva10 += Number(r.iva10) || 0;
    t.total += Number(r.total) || 0;
  }
  return t;
}
