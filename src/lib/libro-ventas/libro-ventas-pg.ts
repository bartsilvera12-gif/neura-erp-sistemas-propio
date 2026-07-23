import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Libro de Ventas — SOLO comprobantes fiscales VÁLIDOS. Nunca lee ventas POS.
 *
 * Validez (por artefacto fiscal real, no por el flag de modo de la empresa):
 *  - Factura: tiene DTE aprobado (`factura_electronica.estado_sifen='aprobado'`)
 *    y `estado <> 'Anulado'`. (El camino autoimpresor se agregará cuando haya
 *    numeración fiscal poblada; hoy ninguna empresa lo usa.)
 *  - Nota de crédito: `estado_erp='aprobada'` + DTE NC aprobado → fila NEGATIVA.
 *
 * IVA por línea: `factura_items` NO guarda la tasa; se deriva del par (subtotal, iva)
 * — la misma inferencia que hace SIFEN. ratio = iva/subtotal ≈ 0 / 0.05 / 0.10.
 *
 * Número fiscal: se extrae del CDC de 44 dígitos (est-punto-número); timbrado desde
 * `empresa_sifen_config`. Fallback `numero_factura` (FAC-###).
 */

export interface LibroVentaRow {
  origen_tipo: "factura" | "nota_credito";
  origen: "manual" | "suscripcion";
  fecha: string | null;
  cliente: string | null;
  ruc: string | null;
  tipo_comprobante: string;
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
  cliente_id: string | null;
}

export interface LibroVentaTotals {
  exento: number; gravado5: number; iva5: number; gravado10: number; iva10: number;
  total: number; cantidad: number;
  facturas_total: number; nc_total: number; neto: number;
}

export interface LibroVentaFilters {
  desde?: string | null;
  hasta?: string | null;
  cliente_id?: string | null;
  condicion?: "contado" | "credito" | null;
  origen?: "manual" | "suscripcion" | null;
  tipo?: "factura" | "nota_credito" | null;
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

// Deriva la tasa (exenta/5/10) desde (subtotal, iva). Ratio exacto 0/0.05/0.10 (IVA incluido).
const RATE_SQL = `
  CASE
    WHEN COALESCE(i.iva,0) = 0 THEN 'exenta'
    WHEN abs(i.iva::numeric / NULLIF(i.subtotal,0) - 0.05) <= 0.005 THEN '5'
    WHEN abs(i.iva::numeric / NULLIF(i.subtotal,0) - 0.10) <= 0.01  THEN '10'
    ELSE '10'
  END`;

// Número fiscal desde el CDC (tipoDE[2] RUC[8] DV[1] EST[3] PUNTO[3] NUMERO[7] ...).
const NUM_FISCAL_SQL = (cdc: string, numeroFactura: string) => `
  CASE WHEN ${cdc} IS NOT NULL AND length(${cdc}) >= 24
       THEN substring(${cdc} from 12 for 3) || '-' || substring(${cdc} from 15 for 3) || '-' || substring(${cdc} from 18 for 7)
       ELSE ${numeroFactura} END`;

export async function listLibroVentas(schemaRaw: string, empresaId: string, f: LibroVentaFilters = {}): Promise<LibroVentaRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tF = quoteSchemaTable(schema, "facturas");
  const tFI = quoteSchemaTable(schema, "factura_items");
  const tFE = quoteSchemaTable(schema, "factura_electronica");
  const tCl = quoteSchemaTable(schema, "clientes");
  const tNC = quoteSchemaTable(schema, "nota_credito");
  const tNCE = quoteSchemaTable(schema, "nota_credito_electronica");
  const tSC = quoteSchemaTable(schema, "empresa_sifen_config");

  const params: unknown[] = [empresaId];
  const outer: string[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.desde) outer.push(`x.fecha >= ${add(f.desde)}::date`);
  if (f.hasta) outer.push(`x.fecha <= ${add(f.hasta)}::date`);
  if (f.cliente_id) outer.push(`x.cliente_id = ${add(f.cliente_id)}::uuid`);
  if (f.condicion) outer.push(`x.condicion = ${add(f.condicion)}`);
  if (f.origen) outer.push(`x.origen = ${add(f.origen)}`);
  if (f.tipo) outer.push(`x.origen_tipo = ${add(f.tipo)}`);
  const outerWhere = outer.length ? `WHERE ${outer.join(" AND ")}` : "";

  const clienteExpr = "COALESCE(NULLIF(btrim(cl.razon_social),''), NULLIF(btrim(cl.nombre),''), NULLIF(btrim(cl.empresa),''))";
  const rucExpr = "COALESCE(NULLIF(btrim(cl.ruc_factura),''), NULLIF(btrim(cl.ruc),''), NULLIF(btrim(cl.documento),''))";

  const sql = `
    WITH timb AS (
      SELECT timbrado_numero FROM ${tSC} WHERE empresa_id = $1::uuid AND activo = true LIMIT 1
    ),
    unificado AS (
      -- ── A) FACTURAS con DTE aprobado ──────────────────────────────────────
      SELECT 'factura'::text AS origen_tipo,
             CASE WHEN f.tipo = 'suscripcion' OR f.suscripcion_id IS NOT NULL THEN 'suscripcion' ELSE 'manual' END AS origen,
             f.fecha::date AS fecha,
             ${clienteExpr} AS cliente, ${rucExpr} AS ruc,
             'Factura'::text AS tipo_comprobante,
             (SELECT timbrado_numero FROM timb) AS timbrado,
             ${NUM_FISCAL_SQL("fe.cdc", "f.numero_factura")} AS numero,
             CASE WHEN f.tipo = 'contado' THEN 'contado' ELSE 'credito' END AS condicion,
             iv.exento, iv.gravado5, iv.iva5, iv.gravado10, iv.iva10,
             f.monto AS total, f.estado AS estado, f.cliente_id AS cliente_id
        FROM ${tF} f
        JOIN ${tFE} fe ON fe.factura_id = f.id AND fe.estado_sifen = 'aprobado'
        LEFT JOIN ${tCl} cl ON cl.id = f.cliente_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(CASE WHEN r.rate='exenta' THEN i.subtotal END),0) AS exento,
            COALESCE(SUM(CASE WHEN r.rate='5'      THEN i.subtotal END),0) AS gravado5,
            COALESCE(SUM(CASE WHEN r.rate='5'      THEN i.iva      END),0) AS iva5,
            COALESCE(SUM(CASE WHEN r.rate='10'     THEN i.subtotal END),0) AS gravado10,
            COALESCE(SUM(CASE WHEN r.rate='10'     THEN i.iva      END),0) AS iva10
          FROM ${tFI} i, LATERAL (SELECT ${RATE_SQL} AS rate) r
          WHERE i.factura_id = f.id
        ) iv ON true
       WHERE f.empresa_id = $1::uuid AND COALESCE(f.estado,'') <> 'Anulado'

      UNION ALL

      -- ── B) NOTAS DE CRÉDITO aprobadas (filas negativas, IVA prorrateado) ───
      SELECT 'nota_credito'::text AS origen_tipo,
             CASE WHEN of.tipo = 'suscripcion' OR of.suscripcion_id IS NOT NULL THEN 'suscripcion' ELSE 'manual' END AS origen,
             n.created_at::date AS fecha,
             ${clienteExpr} AS cliente, ${rucExpr} AS ruc,
             'Nota de Crédito'::text AS tipo_comprobante,
             (SELECT timbrado_numero FROM timb) AS timbrado,
             ${NUM_FISCAL_SQL("nce.cdc", "NULL::text")} AS numero,
             NULL::text AS condicion,
             -round(n.monto * comp.exento    / NULLIF(comp.total,0)) AS exento,
             -round(n.monto * comp.gravado5  / NULLIF(comp.total,0)) AS gravado5,
             -round(n.monto * comp.iva5      / NULLIF(comp.total,0)) AS iva5,
             -round(n.monto * comp.gravado10 / NULLIF(comp.total,0)) AS gravado10,
             -round(n.monto * comp.iva10     / NULLIF(comp.total,0)) AS iva10,
             -n.monto AS total, 'aprobada'::text AS estado, n.cliente_id AS cliente_id
        FROM ${tNC} n
        JOIN ${tNCE} nce ON nce.nota_credito_id = n.id AND nce.estado_sifen = 'aprobado'
        LEFT JOIN ${tF} of ON of.id = n.factura_id
        LEFT JOIN ${tCl} cl ON cl.id = n.cliente_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(CASE WHEN r.rate='exenta' THEN i.subtotal END),0) AS exento,
            COALESCE(SUM(CASE WHEN r.rate='5'      THEN i.subtotal END),0) AS gravado5,
            COALESCE(SUM(CASE WHEN r.rate='5'      THEN i.iva      END),0) AS iva5,
            COALESCE(SUM(CASE WHEN r.rate='10'     THEN i.subtotal END),0) AS gravado10,
            COALESCE(SUM(CASE WHEN r.rate='10'     THEN i.iva      END),0) AS iva10,
            NULLIF(COALESCE(SUM(i.total),0),0) AS total
          FROM ${tFI} i, LATERAL (SELECT ${RATE_SQL} AS rate) r
          WHERE i.factura_id = n.factura_id
        ) comp ON true
       WHERE n.empresa_id = $1::uuid AND n.estado_erp = 'aprobada'
    )
    SELECT x.* FROM unificado x
    ${outerWhere}
    ORDER BY x.fecha DESC NULLS LAST, x.numero DESC`;

  const { rows } = await pool().query<LibroVentaRow>(sql, params);
  return rows;
}

export function computeTotals(rows: LibroVentaRow[]): LibroVentaTotals {
  const t: LibroVentaTotals = {
    exento: 0, gravado5: 0, iva5: 0, gravado10: 0, iva10: 0, total: 0, cantidad: rows.length,
    facturas_total: 0, nc_total: 0, neto: 0,
  };
  for (const r of rows) {
    t.exento += Number(r.exento) || 0;
    t.gravado5 += Number(r.gravado5) || 0;
    t.iva5 += Number(r.iva5) || 0;
    t.gravado10 += Number(r.gravado10) || 0;
    t.iva10 += Number(r.iva10) || 0;
    const v = Number(r.total) || 0;
    t.total += v;
    if (r.origen_tipo === "nota_credito") t.nc_total += v; else t.facturas_total += v;
  }
  t.neto = t.total;
  return t;
}
