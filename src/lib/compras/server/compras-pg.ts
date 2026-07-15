/**
 * PG directo para Compras. Mismo patron que productos-pg / proveedores-pg:
 * pool singleton + queries parametrizadas + identifier escape.
 *
 * insertCompra realiza la operacion en transaccion:
 *   1) inserta compra con numero_control generado por secuencia local
 *   2) inserta movimiento ENTRADA (origen=compra) con audit
 *   3) actualiza producto.precio_venta + costo_promedio + stock_actual
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { getConfigContable, construirLineasDocumento, generarAsientoEnTx, ContabilidadError } from "@/lib/contabilidad/asientos-pg";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface CompraRow {
  id: string;
  empresa_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: string | number;
  moneda: string;
  tipo_cambio: string | number;
  costo_unitario_original: string | number;
  costo_unitario: string | number;
  iva_tipo: string;
  subtotal: string | number;
  monto_iva: string | number;
  total: string | number;
  precio_venta: string | number;
  margen_venta: string | number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  numero_control: string;
  estado: string;
  fecha: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  usuario_nombre: string | null;
  cuenta_contable_id: string | null;
  cuenta_contable_codigo?: string | null;
  cuenta_contable_denominacion?: string | null;
}

const COLS = `
  id, empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
  cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
  iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
  tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
  created_at, updated_at, created_by, usuario_nombre, cuenta_contable_id
`;

export interface InsertCompraInput {
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  moneda: string;
  tipo_cambio: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  cuenta_contable_id: string | null;
  /** Cuenta de pago (contrapartida) para compras al contado. */
  cuenta_contrapartida_id: string | null;
  /** true = compra directa que aumenta stock (Fase 0). false = provendrá de recepción (Fase 4). */
  afecta_stock: boolean;
  /** Clave de idempotencia (uuid) para que un doble-envío no cree dos compras. */
  idempotency_key: string | null;
  created_by: string | null;
  usuario_nombre: string | null;
}

export async function listCompras(
  schemaRaw: string,
  empresaId: string
): Promise<CompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "compras");
  const tPC = quoteSchemaTable(schema, "plan_cuentas");
  const cols = COLS.split(",")
    .map((c) => `c.${c.trim()}`)
    .join(", ");
  const { rows } = await pool().query<CompraRow>(
    `SELECT ${cols},
            pc.cuenta AS cuenta_contable_codigo,
            pc.denominacion AS cuenta_contable_denominacion
       FROM ${t} c
       LEFT JOIN ${tPC} pc ON pc.id = c.cuenta_contable_id
      WHERE c.empresa_id = $1::uuid
      ORDER BY c.fecha DESC LIMIT 500`,
    [empresaId]
  );
  return rows;
}

/**
 * Actualiza SOLO la cuenta contable de una compra (edición acotada).
 * `cuentaContableId` null desasocia. Si es no-null, valida que la cuenta
 * pertenezca a la empresa y sea activa + asentable; si no, lanza error.
 */
export async function updateCompraCuentaContable(
  schemaRaw: string,
  empresaId: string,
  compraId: string,
  cuentaContableId: string | null
): Promise<CompraRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tPC = quoteSchemaTable(schema, "plan_cuentas");

  if (cuentaContableId) {
    const { rows: valid } = await pool().query<{ id: string }>(
      `SELECT id FROM ${tPC}
        WHERE id = $1::uuid AND empresa_id = $2::uuid AND activo = true AND asentable = true`,
      [cuentaContableId, empresaId]
    );
    if (valid.length === 0) {
      throw new Error("La cuenta contable seleccionada no es válida (debe estar activa y ser asentable).");
    }
  }

  const cols = COLS.split(",")
    .map((c) => `c.${c.trim()}`)
    .join(", ");
  const { rows } = await pool().query<CompraRow>(
    `WITH upd AS (
       UPDATE ${tC} SET cuenta_contable_id = $1::uuid, updated_at = now()
        WHERE id = $2::uuid AND empresa_id = $3::uuid
        RETURNING *
     )
     SELECT ${cols},
            pc.cuenta AS cuenta_contable_codigo,
            pc.denominacion AS cuenta_contable_denominacion
       FROM upd c
       LEFT JOIN ${tPC} pc ON pc.id = c.cuenta_contable_id`,
    [cuentaContableId, compraId, empresaId]
  );
  return rows[0] ?? null;
}

/** Genera proximo COMP-XXXXXX leyendo el maximo existente. */
async function nextNumeroControl(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string
): Promise<string> {
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await client.query<{ maxn: number | null }>(
    `SELECT COALESCE(MAX(
       CASE WHEN numero_control ~ '^COMP-[0-9]+$'
            THEN (substring(numero_control from 6))::int
            ELSE 0 END
     ), 0) AS maxn
     FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const next = Number(rows[0]?.maxn ?? 0) + 1;
  return `COMP-${String(next).padStart(6, "0")}`;
}

export interface CompraResult {
  compra: CompraRow;
  movimiento_id: string | null;
  movimiento_warning: string | null;
}

/** Busca una compra por su clave de idempotencia (fuera de transacción). */
async function fetchCompraByIdempotency(
  schema: string,
  empresaId: string,
  idempotencyKey: string
): Promise<CompraRow | null> {
  const tC = quoteSchemaTable(schema, "compras");
  const { rows } = await pool().query<CompraRow>(
    `SELECT ${COLS} FROM ${tC} WHERE empresa_id = $1::uuid AND idempotency_key = $2::uuid LIMIT 1`,
    [empresaId, idempotencyKey]
  );
  return rows[0] ?? null;
}

/**
 * Alta de compra + impacto de inventario, TODO en una única transacción real.
 * Fase 0:
 *  - Idempotencia: con `idempotency_key`, un doble-envío devuelve la compra ya creada
 *    (no crea una segunda compra, movimiento ni stock).
 *  - Atomicidad total: si falla el INSERT de compra, el movimiento o el UPDATE de stock,
 *    se hace ROLLBACK completo (sin best-effort ni warning).
 *  - Vínculo fuerte: el movimiento guarda `documento_tipo='compra'` y `documento_id=compra.id`.
 *  - `afecta_stock=false` (futuras compras desde recepción) omite el movimiento/stock.
 */
export async function insertCompraConImpacto(
  schemaRaw: string,
  empresaId: string,
  d: InsertCompraInput
): Promise<CompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");

  // Fast-path idempotencia: si ya existe una compra con esta clave, devolverla.
  if (d.idempotency_key) {
    const existing = await fetchCompraByIdempotency(schema, empresaId, d.idempotency_key);
    if (existing) return { compra: existing, movimiento_id: null, movimiento_warning: null };
  }

  const client = await pool().connect();
  let movimientoId: string | null = null;
  try {
    await client.query("BEGIN");

    const numero = await nextNumeroControl(client, schema, empresaId);

    let compra: CompraRow;
    try {
      const { rows: compraRows } = await client.query<CompraRow>(
        `INSERT INTO ${tC} (
           empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
           cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
           iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
           tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
           created_by, usuario_nombre, cuenta_contable_id, afecta_stock, idempotency_key, cuenta_contrapartida_id
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4::uuid, $5,
           $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
           $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
           $17, $18::integer, $19, $20, 'registrada', now(),
           $21::uuid, $22, $23::uuid, $24::boolean, $25::uuid, $26::uuid
         )
         RETURNING ${COLS}`,
        [
          empresaId,
          d.proveedor_id,
          d.proveedor_nombre,
          d.producto_id,
          d.producto_nombre,
          d.cantidad,
          d.moneda,
          d.tipo_cambio,
          d.costo_unitario_original,
          d.costo_unitario,
          d.iva_tipo,
          d.subtotal,
          d.monto_iva,
          d.total,
          d.precio_venta,
          d.margen_venta,
          d.tipo_pago,
          d.plazo_dias,
          d.nro_timbrado,
          numero,
          d.created_by,
          d.usuario_nombre,
          d.cuenta_contable_id,
          d.afecta_stock,
          d.idempotency_key,
          d.cuenta_contrapartida_id,
        ]
      );
      compra = compraRows[0];
    } catch (insErr) {
      // Carrera de idempotencia: dos envíos simultáneos con la misma clave.
      const code = (insErr as { code?: string })?.code;
      const constraint = String((insErr as { constraint?: string })?.constraint ?? "");
      if (code === "23505" && constraint.includes("idempotency") && d.idempotency_key) {
        await client.query("ROLLBACK").catch(() => null);
        const existing = await fetchCompraByIdempotency(schema, empresaId, d.idempotency_key);
        if (existing) return { compra: existing, movimiento_id: null, movimiento_warning: null };
      }
      throw insErr;
    }

    // Impacto de inventario SOLO si la compra afecta stock (Fase 0: siempre true).
    // Parte atómica de la transacción: cualquier fallo aquí revierte la compra.
    if (d.afecta_stock) {
      const { rows: movRows } = await client.query<{ id: string }>(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre, documento_tipo, documento_id
         )
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                'ENTRADA', $4::numeric, $5::numeric, 'compra', $6, now(),
                $7::uuid, $8, 'compra', $9::uuid
         FROM ${tP} p WHERE p.id = $2::uuid
         RETURNING id`,
        [
          empresaId,
          d.producto_id,
          d.producto_nombre,
          d.cantidad,
          d.costo_unitario,
          numero,
          d.created_by,
          d.usuario_nombre,
          compra.id,
        ]
      );
      movimientoId = movRows[0]?.id ?? null;
      if (!movimientoId) {
        throw new Error("No se pudo registrar el movimiento de inventario (producto inexistente).");
      }

      const upd = await client.query(
        `UPDATE ${tP}
            SET stock_actual = stock_actual + $1::numeric,
                costo_promedio = $2::numeric,
                precio_venta = $3::numeric,
                updated_at = now()
          WHERE id = $4::uuid AND empresa_id = $5::uuid`,
        [d.cantidad, d.costo_unitario, d.precio_venta, d.producto_id, empresaId]
      );
      if (upd.rowCount === 0) {
        throw new Error("No se pudo actualizar el stock del producto.");
      }
    }

    // Asiento contable de la compra (misma transacción). Requiere cuenta contable.
    if (!d.cuenta_contable_id) {
      throw new ContabilidadError("La compra requiere una cuenta contable para contabilizarse.");
    }
    const config = await getConfigContable(schema, empresaId);
    const esContado = d.tipo_pago !== "credito";
    const ivaTipo = d.iva_tipo === "5" ? "5" : d.iva_tipo === "10" ? "10" : "exenta";
    const lineasAsiento = construirLineasDocumento({
      config,
      lineasFiscales: [{ cuenta_contable_id: d.cuenta_contable_id, descripcion: d.producto_nombre, subtotal: d.subtotal, iva_tipo: ivaTipo, monto_iva: d.monto_iva }],
      total: d.total, esContado, contrapartidaContado: d.cuenta_contrapartida_id, proveedorId: d.proveedor_id,
      documento_tipo: "compra", documento_id: compra.id,
    });
    const now = new Date();
    const fechaContable = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const asiento = await generarAsientoEnTx(client, schema, empresaId, {
      origen_tipo: "compra", origen_id: compra.id, evento_origen: "confirmacion",
      fecha_contable: fechaContable, glosa: `Compra ${compra.numero_control}`,
      moneda: d.moneda === "USD" ? "USD" : "PYG", tipo_cambio: d.tipo_cambio ?? 1,
      lineas: lineasAsiento, createdBy: d.created_by,
    });
    await client.query(
      `UPDATE ${tC} SET estado_contable='contabilizado', asiento_contable_id = $3::uuid WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [compra.id, empresaId, asiento.id]
    );

    await client.query("COMMIT");
    return { compra, movimiento_id: movimientoId, movimiento_warning: null };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
