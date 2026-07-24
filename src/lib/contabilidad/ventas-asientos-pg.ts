import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import {
  getConfigContable, generarAsientoEnTx, ContabilidadError,
  type AsientoLineaInput, type ConfigContable,
} from "@/lib/contabilidad/asientos-pg";

/**
 * Asientos contables de VENTAS (Fase 2). SOLO comprobantes fiscales válidos.
 *
 *  - Factura con DTE aprobado (`factura_electronica.estado_sifen='aprobado'`)
 *    y `estado <> 'Anulado'` → asiento: Debe Clientes/CxC (total); Haber Ventas
 *    (gravadas/exentas/servicios) + IVA Débito 5%/10%. Caja/Banco NO se tocan
 *    (eso es el asiento del cobro, fuera de alcance).
 *  - Nota de crédito electrónica aprobada → asiento inverso (correctivo).
 *
 * Idempotencia estricta: 1 documento fiscal = 1 asiento. Doble capa:
 *  - `estado_contable='contabilizado'` en el documento (guard temprano).
 *  - índice único `uq_asientos_origen (empresa, origen_tipo, origen_id, evento)`.
 * Si el asiento falla, se marca `estado_contable='error'` + `contab_error`,
 * SIN duplicar ni alterar el DTE aprobado.
 *
 * El desglose fiscal por tasa se deriva de (subtotal, iva) de `factura_items`,
 * exactamente igual que el Libro de Ventas (misma inferencia que SIFEN).
 */

type Client = import("pg").PoolClient;

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

const r0 = (v: unknown) => Math.round(Number(v) || 0);

// Tasa por ítem derivada de (subtotal, iva): ratio 0 / 0.05 / 0.10 (IVA incluido).
const RATE_SQL = `
  CASE
    WHEN COALESCE(i.iva,0) = 0 THEN 'exenta'
    WHEN abs(i.iva::numeric / NULLIF(i.subtotal,0) - 0.05) <= 0.005 THEN '5'
    WHEN abs(i.iva::numeric / NULLIF(i.subtotal,0) - 0.10) <= 0.01  THEN '10'
    ELSE '10'
  END`;

interface Desglose { exento: number; gravado5: number; iva5: number; gravado10: number; iva10: number }

/** Desglose fiscal de una factura desde sus ítems. */
async function desgloseFactura(client: Client, schema: string, empresaId: string, facturaId: string): Promise<Desglose> {
  const tFI = quoteSchemaTable(schema, "factura_items");
  const { rows } = await client.query<Desglose>(
    `SELECT
       COALESCE(SUM(CASE WHEN r.rate='exenta' THEN i.subtotal END),0)::float8 AS exento,
       COALESCE(SUM(CASE WHEN r.rate='5'      THEN i.subtotal END),0)::float8 AS gravado5,
       COALESCE(SUM(CASE WHEN r.rate='5'      THEN i.iva      END),0)::float8 AS iva5,
       COALESCE(SUM(CASE WHEN r.rate='10'     THEN i.subtotal END),0)::float8 AS gravado10,
       COALESCE(SUM(CASE WHEN r.rate='10'     THEN i.iva      END),0)::float8 AS iva10
     FROM ${tFI} i, LATERAL (SELECT ${RATE_SQL} AS rate) r
     WHERE i.factura_id = $1::uuid AND i.empresa_id = $2::uuid`,
    [facturaId, empresaId]
  );
  const d = rows[0] ?? { exento: 0, gravado5: 0, iva5: 0, gravado10: 0, iva10: 0 };
  return { exento: r0(d.exento), gravado5: r0(d.gravado5), iva5: r0(d.iva5), gravado10: r0(d.gravado10), iva10: r0(d.iva10) };
}

/**
 * Desglose de una NC: prorratea `nc.monto` según la composición fiscal de la
 * factura de origen (mismo criterio que el Libro de Ventas). Valores positivos.
 */
async function desgloseNotaCredito(client: Client, schema: string, empresaId: string, facturaOrigenId: string | null, ncMonto: number): Promise<Desglose> {
  const monto = r0(ncMonto);
  if (!facturaOrigenId || monto <= 0) return { exento: monto, gravado5: 0, iva5: 0, gravado10: 0, iva10: 0 };
  const base = await desgloseFactura(client, schema, empresaId, facturaOrigenId);
  const totalBase = base.exento + base.gravado5 + base.iva5 + base.gravado10 + base.iva10;
  if (totalBase <= 0) return { exento: monto, gravado5: 0, iva5: 0, gravado10: 0, iva10: 0 };
  // Prorratea cada componente y ajusta el redondeo en el mayor para que sume exacto.
  const parts = {
    exento: r0(monto * base.exento / totalBase),
    gravado5: r0(monto * base.gravado5 / totalBase),
    iva5: r0(monto * base.iva5 / totalBase),
    gravado10: r0(monto * base.gravado10 / totalBase),
    iva10: r0(monto * base.iva10 / totalBase),
  };
  const suma = parts.exento + parts.gravado5 + parts.iva5 + parts.gravado10 + parts.iva10;
  const diff = monto - suma;
  if (diff !== 0) {
    // corrige en el componente de mayor magnitud
    const key = (Object.keys(parts) as (keyof Desglose)[]).reduce((a, b) => (parts[a] >= parts[b] ? a : b));
    parts[key] += diff;
  }
  return parts;
}

/**
 * Líneas del asiento de una factura de venta.
 * Debe Clientes (total); Haber Ventas gravadas/exentas (o servicios) + IVA Débito.
 * El total se toma de la suma de componentes → balance exacto (Debe = Haber).
 */
function construirLineasVenta(opts: {
  config: ConfigContable | null; d: Desglose; esServicio: boolean;
  documento_tipo: string; documento_id: string;
}): { lineas: AsientoLineaInput[]; total: number } {
  const { config, d, esServicio, documento_tipo, documento_id } = opts;
  if (!config?.cuenta_clientes_id) {
    throw new ContabilidadError("Configurá la cuenta general de Clientes (CxC) en Configuración Contable → Ventas.");
  }
  const baseGravada = d.gravado5 + d.gravado10;
  const total = baseGravada + d.exento + d.iva5 + d.iva10;
  if (total <= 0) throw new ContabilidadError("La factura no tiene importes para contabilizar.");

  // Cuentas de ingreso: si es servicio, preferí la cuenta de servicios.
  const ctaGravadas = esServicio
    ? (config.cuenta_ventas_servicios_id ?? config.cuenta_ventas_gravadas_id)
    : (config.cuenta_ventas_gravadas_id ?? config.cuenta_ventas_servicios_id);
  const ctaExentas = esServicio
    ? (config.cuenta_ventas_servicios_id ?? config.cuenta_ventas_exentas_id ?? config.cuenta_ventas_gravadas_id)
    : (config.cuenta_ventas_exentas_id ?? config.cuenta_ventas_gravadas_id ?? config.cuenta_ventas_servicios_id);

  const L = (cuenta: string, descripcion: string, debe: number, haber: number): AsientoLineaInput =>
    ({ cuenta_contable_id: cuenta, descripcion, debe, haber, documento_tipo, documento_id });

  const lineas: AsientoLineaInput[] = [L(config.cuenta_clientes_id, "Clientes / CxC", total, 0)];
  if (baseGravada > 0) {
    if (!ctaGravadas) throw new ContabilidadError("Configurá la cuenta de Ventas Gravadas (o de Servicios) en Configuración Contable → Ventas.");
    lineas.push(L(ctaGravadas, esServicio ? "Ventas de servicios" : "Ventas gravadas", 0, baseGravada));
  }
  if (d.exento > 0) {
    if (!ctaExentas) throw new ContabilidadError("Configurá la cuenta de Ventas Exentas (o de Servicios) en Configuración Contable → Ventas.");
    lineas.push(L(ctaExentas, esServicio ? "Ventas de servicios (exentas)" : "Ventas exentas", 0, d.exento));
  }
  if (d.iva5 > 0) {
    if (!config.cuenta_iva_debito_5_id) throw new ContabilidadError("Configurá la cuenta de IVA Débito 5% en Configuración Contable → Ventas.");
    lineas.push(L(config.cuenta_iva_debito_5_id, "IVA Débito 5%", 0, d.iva5));
  }
  if (d.iva10 > 0) {
    if (!config.cuenta_iva_debito_10_id) throw new ContabilidadError("Configurá la cuenta de IVA Débito 10% en Configuración Contable → Ventas.");
    lineas.push(L(config.cuenta_iva_debito_10_id, "IVA Débito 10%", 0, d.iva10));
  }
  return { lineas, total };
}

/** Líneas de la NC (inverso del asiento de venta): Debe Ventas + IVA; Haber Clientes. */
function construirLineasNC(opts: {
  config: ConfigContable | null; d: Desglose; esServicio: boolean;
  documento_tipo: string; documento_id: string;
}): { lineas: AsientoLineaInput[]; total: number } {
  const base = construirLineasVenta(opts);
  // Invertir debe/haber de cada línea.
  const lineas = base.lineas.map((l) => ({ ...l, debe: l.haber, haber: l.debe }));
  return { lineas, total: base.total };
}

export interface ContabResult { status: "contabilizado" | "ya_contabilizado" | "omitido" | "error"; asientoId?: string; motivo?: string }

/** Marca el documento en error (fuera de la tx del asiento; nunca toca el DTE). */
async function marcarError(schema: string, tabla: "facturas" | "nota_credito", empresaId: string, id: string, msg: string): Promise<void> {
  const t = quoteSchemaTable(schema, tabla);
  await pool().query(
    `UPDATE ${t} SET estado_contable='error', contab_error=$3 WHERE id=$1::uuid AND empresa_id=$2::uuid AND estado_contable <> 'contabilizado'`,
    [id, empresaId, msg.slice(0, 500)]
  ).catch(() => null);
}

/** Contabiliza UNA factura de venta (idempotente). Best-effort: no lanza. */
export async function contabilizarFacturaVenta(schemaRaw: string, empresaId: string, facturaId: string, createdBy: string | null): Promise<ContabResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tF = quoteSchemaTable(schema, "facturas");
  const tFE = quoteSchemaTable(schema, "factura_electronica");
  const config = await getConfigContable(schema, empresaId);

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: fr } = await client.query<{
      id: string; estado: string; estado_contable: string; asiento_contable_id: string | null;
      tipo: string; suscripcion_id: string | null; fecha_str: string; numero_factura: string; moneda: string;
    }>(
      `SELECT id, estado, estado_contable, asiento_contable_id, tipo, suscripcion_id,
              to_char(fecha,'YYYY-MM-DD') AS fecha_str, numero_factura, moneda
         FROM ${tF} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [facturaId, empresaId]
    );
    const f = fr[0];
    if (!f) { await client.query("ROLLBACK"); return { status: "omitido", motivo: "factura inexistente" }; }
    if (String(f.estado) === "Anulado") { await client.query("ROLLBACK"); return { status: "omitido", motivo: "anulada" }; }
    if (f.estado_contable === "contabilizado" && f.asiento_contable_id) { await client.query("ROLLBACK"); return { status: "ya_contabilizado" }; }

    const { rows: fe } = await client.query<{ estado_sifen: string }>(
      `SELECT estado_sifen FROM ${tFE} WHERE factura_id=$1::uuid AND empresa_id=$2::uuid LIMIT 1`,
      [facturaId, empresaId]
    );
    if (fe[0]?.estado_sifen !== "aprobado") { await client.query("ROLLBACK"); return { status: "omitido", motivo: "sin DTE aprobado" }; }

    const d = await desgloseFactura(client, schema, empresaId, facturaId);
    const esServicio = f.tipo === "suscripcion" || f.suscripcion_id != null;
    const { lineas, total } = construirLineasVenta({ config, d, esServicio, documento_tipo: "factura_venta", documento_id: facturaId });

    const asiento = await generarAsientoEnTx(client, schema, empresaId, {
      origen_tipo: "factura_venta", origen_id: facturaId, evento_origen: "dte_aprobado",
      fecha_contable: f.fecha_str, glosa: `Venta ${f.numero_factura}`,
      moneda: f.moneda === "USD" ? "USD" : "PYG", tipo_cambio: 1, lineas, createdBy,
    });
    void total;
    await client.query(
      `UPDATE ${tF} SET estado_contable='contabilizado', asiento_contable_id=$3::uuid, contab_error=NULL WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [facturaId, empresaId, asiento.id]
    );
    await client.query("COMMIT");
    // Hook best-effort: reclasificar anticipos de cobros de esta factura (Debe
    // Anticipos / Haber Clientes). El backfill de anticipos es la red de seguridad.
    try {
      const { reclasificarAnticiposDeFactura } = await import("@/lib/cobranzas/conciliacion-pg");
      await reclasificarAnticiposDeFactura(schema, empresaId, facturaId, createdBy);
    } catch (e2) {
      console.error("[contabilizarFacturaVenta] hook reclasificacion anticipos", e2 instanceof Error ? e2.message : e2);
    }
    return { status: "contabilizado", asientoId: asiento.id };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    const msg = e instanceof Error ? e.message : "Error al contabilizar la factura.";
    await marcarError(schema, "facturas", empresaId, facturaId, msg);
    return { status: "error", motivo: msg };
  } finally {
    client.release();
  }
}

/** Contabiliza UNA nota de crédito de venta (asiento inverso, idempotente). Best-effort. */
export async function contabilizarNotaCreditoVenta(schemaRaw: string, empresaId: string, ncId: string, createdBy: string | null): Promise<ContabResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tNC = quoteSchemaTable(schema, "nota_credito");
  const tNCE = quoteSchemaTable(schema, "nota_credito_electronica");
  const tF = quoteSchemaTable(schema, "facturas");
  const config = await getConfigContable(schema, empresaId);

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: nr } = await client.query<{
      id: string; estado_erp: string; estado_contable: string; asiento_contable_id: string | null;
      factura_id: string | null; monto: string; created_str: string; moneda_snapshot: string | null;
    }>(
      `SELECT id, estado_erp, estado_contable, asiento_contable_id, factura_id, monto,
              to_char(created_at,'YYYY-MM-DD') AS created_str, moneda_snapshot
         FROM ${tNC} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [ncId, empresaId]
    );
    const n = nr[0];
    if (!n) { await client.query("ROLLBACK"); return { status: "omitido", motivo: "NC inexistente" }; }
    if (n.estado_erp !== "aprobada") { await client.query("ROLLBACK"); return { status: "omitido", motivo: "NC no aprobada" }; }
    if (n.estado_contable === "contabilizado" && n.asiento_contable_id) { await client.query("ROLLBACK"); return { status: "ya_contabilizado" }; }

    const { rows: nce } = await client.query<{ estado_sifen: string }>(
      `SELECT estado_sifen FROM ${tNCE} WHERE nota_credito_id=$1::uuid AND empresa_id=$2::uuid LIMIT 1`,
      [ncId, empresaId]
    );
    if (nce[0]?.estado_sifen !== "aprobado") { await client.query("ROLLBACK"); return { status: "omitido", motivo: "sin DTE NC aprobado" }; }

    // ¿La factura de origen es de servicio? (para enrutar la cuenta de ingreso)
    let esServicio = false;
    if (n.factura_id) {
      const { rows: of } = await client.query<{ tipo: string; suscripcion_id: string | null }>(
        `SELECT tipo, suscripcion_id FROM ${tF} WHERE id=$1::uuid AND empresa_id=$2::uuid`, [n.factura_id, empresaId]
      );
      esServicio = of[0]?.tipo === "suscripcion" || of[0]?.suscripcion_id != null;
    }

    const d = await desgloseNotaCredito(client, schema, empresaId, n.factura_id, Number(n.monto));
    const { lineas } = construirLineasNC({ config, d, esServicio, documento_tipo: "nota_credito_venta", documento_id: ncId });

    const asiento = await generarAsientoEnTx(client, schema, empresaId, {
      origen_tipo: "nota_credito_venta", origen_id: ncId, evento_origen: "dte_aprobado",
      fecha_contable: n.created_str, glosa: `Nota de crédito ${ncId.slice(0, 8)}`,
      moneda: n.moneda_snapshot === "USD" ? "USD" : "PYG", tipo_cambio: 1, lineas, createdBy,
    });
    await client.query(
      `UPDATE ${tNC} SET estado_contable='contabilizado', asiento_contable_id=$3::uuid, contab_error=NULL WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [ncId, empresaId, asiento.id]
    );
    await client.query("COMMIT");
    return { status: "contabilizado", asientoId: asiento.id };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    const msg = e instanceof Error ? e.message : "Error al contabilizar la NC.";
    await marcarError(schema, "nota_credito", empresaId, ncId, msg);
    return { status: "error", motivo: msg };
  } finally {
    client.release();
  }
}

export interface SweepResult {
  facturas_contabilizadas: number; facturas_error: number; facturas_ya: number; facturas_omitidas: number;
  nc_contabilizadas: number; nc_error: number; nc_ya: number; nc_omitidas: number;
  errores: { tipo: string; id: string; motivo: string }[];
}

/**
 * Backfill/sweep idempotente: contabiliza TODA factura y NC con DTE aprobado que
 * aún no tenga asiento. Cada documento va en su propia transacción (un fallo no
 * frena al resto). No toca documentos no fiscales ni duplica asientos.
 */
export async function sweepContabilizarVentas(schemaRaw: string, empresaId: string, createdBy: string | null): Promise<SweepResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tF = quoteSchemaTable(schema, "facturas");
  const tFE = quoteSchemaTable(schema, "factura_electronica");
  const tNC = quoteSchemaTable(schema, "nota_credito");
  const tNCE = quoteSchemaTable(schema, "nota_credito_electronica");

  const res: SweepResult = {
    facturas_contabilizadas: 0, facturas_error: 0, facturas_ya: 0, facturas_omitidas: 0,
    nc_contabilizadas: 0, nc_error: 0, nc_ya: 0, nc_omitidas: 0, errores: [],
  };

  const { rows: facs } = await pool().query<{ id: string }>(
    `SELECT f.id FROM ${tF} f
       JOIN ${tFE} fe ON fe.factura_id=f.id AND fe.estado_sifen='aprobado'
      WHERE f.empresa_id=$1::uuid AND COALESCE(f.estado,'')<>'Anulado' AND f.estado_contable <> 'contabilizado'
      ORDER BY f.fecha ASC`,
    [empresaId]
  );
  for (const f of facs) {
    const r = await contabilizarFacturaVenta(schema, empresaId, f.id, createdBy);
    if (r.status === "contabilizado") res.facturas_contabilizadas++;
    else if (r.status === "ya_contabilizado") res.facturas_ya++;
    else if (r.status === "error") { res.facturas_error++; res.errores.push({ tipo: "factura", id: f.id, motivo: r.motivo ?? "" }); }
    else res.facturas_omitidas++;
  }

  const { rows: ncs } = await pool().query<{ id: string }>(
    `SELECT n.id FROM ${tNC} n
       JOIN ${tNCE} nce ON nce.nota_credito_id=n.id AND nce.estado_sifen='aprobado'
      WHERE n.empresa_id=$1::uuid AND n.estado_erp='aprobada' AND n.estado_contable <> 'contabilizado'
      ORDER BY n.created_at ASC`,
    [empresaId]
  );
  for (const n of ncs) {
    const r = await contabilizarNotaCreditoVenta(schema, empresaId, n.id, createdBy);
    if (r.status === "contabilizado") res.nc_contabilizadas++;
    else if (r.status === "ya_contabilizado") res.nc_ya++;
    else if (r.status === "error") { res.nc_error++; res.errores.push({ tipo: "nota_credito", id: n.id, motivo: r.motivo ?? "" }); }
    else res.nc_omitidas++;
  }

  return res;
}
