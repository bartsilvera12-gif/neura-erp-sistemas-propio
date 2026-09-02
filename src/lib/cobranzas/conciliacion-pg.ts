import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { getConfigContable, generarAsientoEnTx, getAsientoConDetalles, ContabilidadError, type AsientoLineaInput } from "@/lib/contabilidad/asientos-pg";

/**
 * Conciliación bancaria — transferencias pendientes de aprobación (SOLO transferencias).
 *
 * Registrar: fila `cobros_pendientes` estado='pendiente'. NO reduce saldo, NO asiento.
 * Aprobar (ATÓMICO): nace el `pago` → reduce saldo + asiento de cobro + estado del pendiente:
 *   - factura con asiento de venta  → Debe Banco / Haber Clientes.
 *   - factura sin asiento de venta  → Debe Banco / Haber Anticipos (pago.es_anticipo=true).
 * Reclasificación (al aprobarse el DTE de la factura): Debe Anticipos / Haber Clientes.
 * Rechazar: exige motivo; no toca saldo ni contabilidad.
 */

export class ConciliacionError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

/** Normaliza para el control de duplicados: banco = mayúsculas + espacios colapsados; nº op = alfanumérico en mayúsculas. */
export function normBanco(s: string): string { return String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim(); }
export function normNumeroOp(s: string): string { return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

export interface RegistrarTransferenciaInput {
  factura_id: string;
  monto: number;
  fecha: string;
  banco_origen: string;
  titular: string;
  numero_operacion: string;
  idempotency_key: string | null;
  created_by: string | null;
}

export interface CobroPendienteRow {
  id: string; factura_id: string; cliente_id: string | null; monto: string | number; fecha: string;
  banco_origen: string; titular: string; numero_operacion: string; comprobante_path: string | null;
  estado: string; motivo_rechazo: string | null; pago_id: string | null;
  numero_factura?: string | null; cliente_nombre?: string | null; saldo_factura?: string | number | null;
  created_at: string;
  aprobado_by?: string | null; aprobado_at?: string | null;
  rechazado_by?: string | null; rechazado_at?: string | null;
  anulado_by?: string | null; anulado_at?: string | null; motivo_anulacion?: string | null;
  created_by?: string | null; vendedor_usuario_id?: string | null;
  /** Nombres resueltos en la capa API (catálogo de usuarios). */
  aprobado_por_nombre?: string | null; rechazado_por_nombre?: string | null; anulado_por_nombre?: string | null;
  creado_por_nombre?: string | null; vendedor_nombre?: string | null;
}

const COLS = `id, factura_id, cliente_id, monto, fecha, banco_origen, titular, numero_operacion,
  comprobante_path, estado, motivo_rechazo, pago_id, created_at`;

/** Alta de una transferencia pendiente (idempotente + anti-duplicado). */
export async function registrarTransferencia(schemaRaw: string, empresaId: string, d: RegistrarTransferenciaInput): Promise<CobroPendienteRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cobros_pendientes");
  const tF = quoteSchemaTable(schema, "facturas");

  if (!(Number(d.monto) > 0)) throw new ConciliacionError("El monto debe ser mayor a 0.");
  if (!String(d.banco_origen ?? "").trim()) throw new ConciliacionError("Falta el banco de origen.");
  if (!String(d.titular ?? "").trim()) throw new ConciliacionError("Falta el titular.");
  if (!String(d.numero_operacion ?? "").trim()) throw new ConciliacionError("Falta el número de operación.");

  // Factura válida + saldo suficiente (control blando; el firme es al aprobar).
  const { rows: fr } = await pool().query<{ estado: string; saldo: string; cliente_id: string | null }>(
    `SELECT estado, saldo, cliente_id FROM ${tF} WHERE id=$1::uuid AND empresa_id=$2::uuid`, [d.factura_id, empresaId]
  );
  if (!fr[0]) throw new ConciliacionError("Factura no encontrada.", 404);
  if (["Anulado", "Corregida NC"].includes(fr[0].estado)) throw new ConciliacionError("La factura está anulada o corregida por NC.");
  if (Number(d.monto) > Number(fr[0].saldo)) throw new ConciliacionError(`El monto (${d.monto}) supera el saldo de la factura (${fr[0].saldo}).`);

  const bancoNorm = normBanco(d.banco_origen);
  const opNorm = normNumeroOp(d.numero_operacion);
  if (!opNorm) throw new ConciliacionError("El número de operación no es válido.");

  try {
    const { rows } = await pool().query<CobroPendienteRow>(
      `INSERT INTO ${tC} (empresa_id, factura_id, cliente_id, monto, fecha, banco_origen, banco_origen_norm,
         titular, numero_operacion, numero_operacion_norm, estado, idempotency_key, created_by)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::date,$6,$7,$8,$9,$10,'pendiente',$11::uuid,$12::uuid)
       RETURNING ${COLS}`,
      [empresaId, d.factura_id, fr[0].cliente_id, d.monto, d.fecha, d.banco_origen.trim(), bancoNorm,
       d.titular.trim(), d.numero_operacion.trim(), opNorm, d.idempotency_key, d.created_by]
    );
    return rows[0];
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const constraint = String((e as { constraint?: string })?.constraint ?? "");
    if (code === "23505") {
      if (constraint.includes("idem") && d.idempotency_key) {
        const { rows } = await pool().query<CobroPendienteRow>(
          `SELECT ${COLS} FROM ${tC} WHERE empresa_id=$1::uuid AND idempotency_key=$2::uuid LIMIT 1`, [empresaId, d.idempotency_key]
        );
        if (rows[0]) return rows[0];
      }
      throw new ConciliacionError("Ya existe una transferencia con ese banco de origen y número de operación.", 409);
    }
    throw e;
  }
}

export interface RegistrarTransferenciaMultipleInput {
  banco_origen: string;
  titular: string;
  numero_operacion: string;
  fecha: string;
  created_by: string | null;
  items: { factura_id: string; monto: number; idempotency_key: string | null }[];
}

/**
 * Cobro múltiple: UNA transferencia (mismo banco + N° de operación) aplicada a
 * VARIAS facturas del cliente. Crea un `cobros_pendientes` por factura en UNA
 * transacción atómica (o todas o ninguna). El comprobante se sube aparte y se
 * comparte (updateComprobantePath por cada fila). NO reduce saldo ni contabiliza:
 * cada fila se aprueba en Conciliación como cualquier transferencia.
 */
export async function registrarTransferenciaMultiple(
  schemaRaw: string,
  empresaId: string,
  d: RegistrarTransferenciaMultipleInput
): Promise<CobroPendienteRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cobros_pendientes");
  const tF = quoteSchemaTable(schema, "facturas");

  if (!String(d.banco_origen ?? "").trim()) throw new ConciliacionError("Falta el banco de origen.");
  if (!String(d.titular ?? "").trim()) throw new ConciliacionError("Falta el titular.");
  if (!String(d.numero_operacion ?? "").trim()) throw new ConciliacionError("Falta el número de operación.");
  const items = (d.items ?? []).filter((it) => it && it.factura_id && Number(it.monto) > 0);
  if (items.length === 0) throw new ConciliacionError("Seleccioná al menos una factura con monto.");

  const bancoNorm = normBanco(d.banco_origen);
  const opNorm = normNumeroOp(d.numero_operacion);
  if (!opNorm) throw new ConciliacionError("El número de operación no es válido.");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out: CobroPendienteRow[] = [];
    for (const it of items) {
      const { rows: fr } = await client.query<{ estado: string; saldo: string; cliente_id: string | null; numero_factura: string }>(
        `SELECT estado, saldo, cliente_id, numero_factura FROM ${tF} WHERE id=$1::uuid AND empresa_id=$2::uuid`,
        [it.factura_id, empresaId]
      );
      const f = fr[0];
      if (!f) throw new ConciliacionError("Factura no encontrada.", 404);
      if (["Anulado", "Corregida NC"].includes(f.estado)) {
        throw new ConciliacionError(`La factura ${f.numero_factura} está anulada o corregida por NC.`);
      }
      if (Number(it.monto) > Number(f.saldo)) {
        throw new ConciliacionError(`El monto (${it.monto}) supera el saldo de la factura ${f.numero_factura} (${f.saldo}).`);
      }
      try {
        const { rows } = await client.query<CobroPendienteRow>(
          `INSERT INTO ${tC} (empresa_id, factura_id, cliente_id, monto, fecha, banco_origen, banco_origen_norm,
             titular, numero_operacion, numero_operacion_norm, estado, idempotency_key, created_by)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::date,$6,$7,$8,$9,$10,'pendiente',$11::uuid,$12::uuid)
           RETURNING ${COLS}`,
          [empresaId, it.factura_id, f.cliente_id, it.monto, d.fecha, d.banco_origen.trim(), bancoNorm,
           d.titular.trim(), d.numero_operacion.trim(), opNorm, it.idempotency_key, d.created_by]
        );
        out.push(rows[0]);
      } catch (e) {
        if ((e as { code?: string })?.code === "23505") {
          throw new ConciliacionError(`Ya existe una carga para la factura ${f.numero_factura} con ese banco y N° de operación.`, 409);
        }
        throw e;
      }
    }
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}

export async function updateComprobantePath(schemaRaw: string, empresaId: string, cobroId: string, path: string | null, mime: string | null): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cobros_pendientes");
  await pool().query(
    `UPDATE ${tC} SET comprobante_path=$3, comprobante_mime=$4, updated_at=now() WHERE id=$1::uuid AND empresa_id=$2::uuid`,
    [cobroId, empresaId, path, mime]
  );
}

export async function getCobroPendiente(schemaRaw: string, empresaId: string, cobroId: string): Promise<CobroPendienteRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cobros_pendientes");
  const { rows } = await pool().query<CobroPendienteRow>(
    `SELECT ${COLS}, comprobante_mime FROM ${tC} WHERE id=$1::uuid AND empresa_id=$2::uuid`, [cobroId, empresaId]
  );
  return rows[0] ?? null;
}

export async function listCobrosPendientes(schemaRaw: string, empresaId: string, f: { estado?: string | null } = {}): Promise<CobroPendienteRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cobros_pendientes");
  const tF = quoteSchemaTable(schema, "facturas");
  const tCl = quoteSchemaTable(schema, "clientes");
  const params: unknown[] = [empresaId];
  const where: string[] = ["c.empresa_id = $1::uuid"];
  if (f.estado) { params.push(f.estado); where.push(`c.estado = $${params.length}`); }
  const { rows } = await pool().query<CobroPendienteRow>(
    `SELECT c.id, c.factura_id, c.cliente_id, c.monto, c.fecha, c.banco_origen, c.titular, c.numero_operacion,
            c.comprobante_path, c.estado, c.motivo_rechazo, c.pago_id, c.created_at,
            c.aprobado_by, c.aprobado_at, c.rechazado_by, c.rechazado_at,
            c.anulado_by, c.anulado_at, c.motivo_anulacion, c.created_by,
            f.numero_factura, f.saldo AS saldo_factura, f.vendedor_usuario_id,
            COALESCE(NULLIF(btrim(cl.razon_social),''), NULLIF(btrim(cl.nombre),''), NULLIF(btrim(cl.empresa),'')) AS cliente_nombre
       FROM ${tC} c
       LEFT JOIN ${tF} f ON f.id = c.factura_id
       LEFT JOIN ${tCl} cl ON cl.id = c.cliente_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC LIMIT 500`,
    params
  );
  return rows;
}

export interface AprobarResult { pago_id: string; asiento_id: string; es_anticipo: boolean }

/** Aprueba una transferencia en UNA transacción atómica: pago + saldo + asiento + estado del pendiente. */
export async function aprobarTransferencia(schemaRaw: string, empresaId: string, cobroId: string, userId: string | null): Promise<AprobarResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cobros_pendientes");
  const tF = quoteSchemaTable(schema, "facturas");
  const tP = quoteSchemaTable(schema, "pagos");
  const config = await getConfigContable(schema, empresaId);

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: cr } = await client.query<{ id: string; estado: string; factura_id: string; cliente_id: string | null; monto: string; fecha: string; numero_operacion: string }>(
      `SELECT id, estado, factura_id, cliente_id, monto, to_char(fecha,'YYYY-MM-DD') AS fecha, numero_operacion
         FROM ${tC} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`, [cobroId, empresaId]
    );
    const c = cr[0];
    if (!c) throw new ConciliacionError("Transferencia no encontrada.", 404);
    if (c.estado !== "pendiente") throw new ConciliacionError(`La transferencia ya está ${c.estado}.`, 409);

    const { rows: fr } = await client.query<{ estado: string; estado_contable: string; saldo: string; cliente_id: string | null; moneda: string; numero_factura: string }>(
      `SELECT estado, estado_contable, saldo, cliente_id, moneda, numero_factura FROM ${tF} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [c.factura_id, empresaId]
    );
    const f = fr[0];
    if (!f) throw new ConciliacionError("Factura no encontrada.", 404);
    if (["Anulado", "Corregida NC"].includes(f.estado)) throw new ConciliacionError("La factura está anulada o corregida por NC.");
    const monto = Number(c.monto);
    const saldo = Number(f.saldo);
    if (monto > saldo) throw new ConciliacionError(`El monto (${monto}) supera el saldo actual de la factura (${saldo}).`, 409);

    const esAnticipo = f.estado_contable !== "contabilizado";

    // 1) Nace el pago (reduce saldo). usuario_id se omite: FK a auth.users y el
    //    userId acá es el id de catálogo ERP. La auditoría queda en cobros_pendientes.aprobado_by.
    const { rows: pr } = await client.query<{ id: string }>(
      `INSERT INTO ${tP} (empresa_id, factura_id, cliente_id, monto, fecha_pago, metodo_pago, referencia,
         es_anticipo, cobro_pendiente_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::date,'transferencia',$6,$7::boolean,$8::uuid)
       RETURNING id`,
      [empresaId, c.factura_id, f.cliente_id, monto, c.fecha, c.numero_operacion, esAnticipo, cobroId]
    );
    const pagoId = pr[0].id;

    const nuevoSaldo = Math.max(0, saldo - monto);
    const nuevoEstado = nuevoSaldo <= 0 ? "Pagado" : f.estado === "Vencido" ? "Vencido" : "Pendiente";
    await client.query(`UPDATE ${tF} SET saldo=$3::numeric, estado=$4, updated_at=now() WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [c.factura_id, empresaId, nuevoSaldo, nuevoEstado]);

    // 2) Asiento de cobro: Debe Banco / Haber Clientes (o Anticipos).
    if (!config?.cuenta_banco_id) throw new ContabilidadError("Configurá la cuenta de Banco en Configuración Contable.");
    const ctaHaber = esAnticipo ? config?.cuenta_anticipos_clientes_id : config?.cuenta_clientes_id;
    if (!ctaHaber) throw new ContabilidadError(esAnticipo
      ? "Configurá la cuenta de Anticipos de Clientes en Configuración Contable."
      : "Configurá la cuenta general de Clientes (CxC) en Configuración Contable.");
    const lineas: AsientoLineaInput[] = [
      { cuenta_contable_id: config.cuenta_banco_id, descripcion: "Cobro por transferencia", debe: monto, haber: 0, documento_tipo: "cobro", documento_id: pagoId },
      { cuenta_contable_id: ctaHaber, descripcion: esAnticipo ? "Anticipos de clientes" : "Clientes / CxC", debe: 0, haber: monto, documento_tipo: "cobro", documento_id: pagoId },
    ];
    const asiento = await generarAsientoEnTx(client, schema, empresaId, {
      origen_tipo: "cobro_cliente", origen_id: pagoId, evento_origen: "conciliacion_aprobada",
      fecha_contable: c.fecha, glosa: `Cobro transferencia ${f.numero_factura}`,
      moneda: f.moneda === "USD" ? "USD" : "PYG", tipo_cambio: 1, lineas, createdBy: userId,
    });
    await client.query(`UPDATE ${tP} SET estado_contable='contabilizado', asiento_contable_id=$3::uuid WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [pagoId, empresaId, asiento.id]);

    // 3) Estado del pendiente.
    await client.query(`UPDATE ${tC} SET estado='aprobado', pago_id=$3::uuid, aprobado_by=$4::uuid, aprobado_at=now(), updated_at=now() WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [cobroId, empresaId, pagoId, userId]);

    await client.query("COMMIT");
    return { pago_id: pagoId, asiento_id: asiento.id, es_anticipo: esAnticipo };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}

/** Rechaza una transferencia (exige motivo; no toca factura ni contabilidad). */
export async function rechazarTransferencia(schemaRaw: string, empresaId: string, cobroId: string, motivo: string, userId: string | null): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cobros_pendientes");
  if (!motivo?.trim()) throw new ConciliacionError("Indicá el motivo del rechazo.");
  const { rows } = await pool().query<{ estado: string }>(
    `SELECT estado FROM ${tC} WHERE id=$1::uuid AND empresa_id=$2::uuid`, [cobroId, empresaId]
  );
  if (!rows[0]) throw new ConciliacionError("Transferencia no encontrada.", 404);
  if (rows[0].estado !== "pendiente") throw new ConciliacionError(`La transferencia ya está ${rows[0].estado}.`, 409);
  await pool().query(
    `UPDATE ${tC} SET estado='rechazado', motivo_rechazo=$3, rechazado_by=$4::uuid, rechazado_at=now(), updated_at=now()
      WHERE id=$1::uuid AND empresa_id=$2::uuid AND estado='pendiente'`,
    [cobroId, empresaId, motivo.trim(), userId]
  );
}

/** Fecha de hoy (America/Asuncion) para la fecha contable de la reversión. */
function hoyPY(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export interface AnularResult { asiento_reversion_id: string | null }

/**
 * Anula una transferencia YA APROBADA con REVERSIÓN CONTABLE (no borra historia), atómico:
 *  1) contra-asiento invirtiendo las líneas del asiento original (Debe↔Haber),
 *  2) restaura saldo/estado de la factura,
 *  3) marca el pago 'revertido' (queda fuera de comisiones/cobrado),
 *  4) deja el cobro en estado 'anulado' con motivo + auditoría.
 */
export async function anularTransferencia(schemaRaw: string, empresaId: string, cobroId: string, motivo: string, userId: string | null): Promise<AnularResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!motivo?.trim()) throw new ConciliacionError("Indicá el motivo de la anulación.");
  const tC = quoteSchemaTable(schema, "cobros_pendientes");
  const tF = quoteSchemaTable(schema, "facturas");
  const tP = quoteSchemaTable(schema, "pagos");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: cr } = await client.query<{ estado: string; factura_id: string; monto: string; pago_id: string | null }>(
      `SELECT estado, factura_id, monto, pago_id FROM ${tC} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [cobroId, empresaId]
    );
    const c = cr[0];
    if (!c) throw new ConciliacionError("Transferencia no encontrada.", 404);
    if (c.estado !== "aprobado") throw new ConciliacionError(`Solo se puede anular una transferencia aprobada (está ${c.estado}).`, 409);
    if (!c.pago_id) throw new ConciliacionError("La aprobación no tiene pago asociado; no se puede revertir.", 409);

    const { rows: pr } = await client.query<{ id: string; asiento_contable_id: string | null; estado_contable: string }>(
      `SELECT id, asiento_contable_id, estado_contable FROM ${tP} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [c.pago_id, empresaId]
    );
    const p = pr[0];
    if (!p) throw new ConciliacionError("Pago no encontrado.", 404);
    if (p.estado_contable === "revertido") throw new ConciliacionError("El pago ya fue revertido.", 409);

    const { rows: fr } = await client.query<{ estado: string; saldo: string; moneda: string; numero_factura: string }>(
      `SELECT estado, saldo, moneda, numero_factura FROM ${tF} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [c.factura_id, empresaId]
    );
    const f = fr[0];
    if (!f) throw new ConciliacionError("Factura no encontrada.", 404);
    const monto = Number(c.monto);

    // 1) Contra-asiento: invertir las líneas del asiento original (Debe↔Haber).
    let reversionId: string | null = null;
    if (p.asiento_contable_id) {
      const orig = await getAsientoConDetalles(client, schema, empresaId, p.asiento_contable_id);
      if (orig && orig.detalles.length > 0) {
        const lineas: AsientoLineaInput[] = orig.detalles.map((l) => ({
          cuenta_contable_id: l.cuenta_contable_id,
          descripcion: `Reversión: ${l.descripcion ?? ""}`.slice(0, 200),
          debe: Number(l.haber) || 0,
          haber: Number(l.debe) || 0,
          documento_tipo: "cobro",
          documento_id: p.id,
        }));
        const asiento = await generarAsientoEnTx(client, schema, empresaId, {
          origen_tipo: "reversion", origen_id: p.id, evento_origen: "conciliacion_anulada",
          fecha_contable: hoyPY(), glosa: `Reversión cobro ${f.numero_factura} (anulación de transferencia)`,
          moneda: f.moneda === "USD" ? "USD" : "PYG", tipo_cambio: 1, lineas, createdBy: userId,
        });
        reversionId = asiento.id;
      }
    }

    // 2) Restaurar saldo/estado de la factura.
    const nuevoSaldo = Number(f.saldo) + monto;
    const nuevoEstado = f.estado === "Pagado" ? "Pendiente" : f.estado;
    await client.query(`UPDATE ${tF} SET saldo=$3::numeric, estado=$4, updated_at=now() WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [c.factura_id, empresaId, nuevoSaldo, nuevoEstado]);

    // 3) Marcar el pago revertido (fuera de comisiones/cobrado).
    await client.query(`UPDATE ${tP} SET estado_contable='revertido' WHERE id=$1::uuid AND empresa_id=$2::uuid`, [p.id, empresaId]);

    // 4) Cobro → anulado (auditoría).
    await client.query(
      `UPDATE ${tC} SET estado='anulado', motivo_anulacion=$3, anulado_by=$4::uuid, anulado_at=now(), asiento_reversion_id=$5::uuid, updated_at=now()
        WHERE id=$1::uuid AND empresa_id=$2::uuid AND estado='aprobado'`,
      [cobroId, empresaId, motivo.trim(), userId, reversionId]
    );

    await client.query("COMMIT");
    return { asiento_reversion_id: reversionId };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}

// ── Reclasificación de anticipos (al aprobarse el DTE de la factura) ─────────

/** Reclasifica UN pago-anticipo (Debe Anticipos / Haber Clientes). Idempotente. Best-effort. */
export async function reclasificarAnticipoPago(schemaRaw: string, empresaId: string, pagoId: string, userId: string | null): Promise<"reclasificado" | "omitido" | { error: string }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tP = quoteSchemaTable(schema, "pagos");
  const tF = quoteSchemaTable(schema, "facturas");
  const config = await getConfigContable(schema, empresaId);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: pr } = await client.query<{ id: string; monto: string; es_anticipo: boolean; estado_contable: string; factura_id: string; fecha_pago: string }>(
      `SELECT id, monto, es_anticipo, estado_contable, factura_id, to_char(fecha_pago,'YYYY-MM-DD') AS fecha_pago
         FROM ${tP} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`, [pagoId, empresaId]
    );
    const p = pr[0];
    if (!p || !p.es_anticipo || p.estado_contable !== "contabilizado") { await client.query("ROLLBACK"); return "omitido"; }
    const { rows: fr } = await client.query<{ estado_contable: string; moneda: string; numero_factura: string }>(
      `SELECT estado_contable, moneda, numero_factura FROM ${tF} WHERE id=$1::uuid AND empresa_id=$2::uuid`, [p.factura_id, empresaId]
    );
    if (fr[0]?.estado_contable !== "contabilizado") { await client.query("ROLLBACK"); return "omitido"; }

    if (!config?.cuenta_anticipos_clientes_id || !config?.cuenta_clientes_id) {
      throw new ContabilidadError("Faltan cuentas de Anticipos/Clientes en Configuración Contable.");
    }
    const monto = Number(p.monto);
    const lineas: AsientoLineaInput[] = [
      { cuenta_contable_id: config.cuenta_anticipos_clientes_id, descripcion: "Aplicación de anticipo", debe: monto, haber: 0, documento_tipo: "cobro", documento_id: pagoId },
      { cuenta_contable_id: config.cuenta_clientes_id, descripcion: "Clientes / CxC", debe: 0, haber: monto, documento_tipo: "cobro", documento_id: pagoId },
    ];
    await generarAsientoEnTx(client, schema, empresaId, {
      origen_tipo: "reclasificacion_anticipo", origen_id: pagoId, evento_origen: "dte_aprobado",
      fecha_contable: p.fecha_pago, glosa: `Aplicación anticipo ${fr[0].numero_factura}`,
      moneda: fr[0].moneda === "USD" ? "USD" : "PYG", tipo_cambio: 1, lineas, createdBy: userId,
    });
    await client.query(`UPDATE ${tP} SET es_anticipo=false WHERE id=$1::uuid AND empresa_id=$2::uuid`, [pagoId, empresaId]);
    await client.query("COMMIT");
    return "reclasificado";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reclasificarAnticipoPago]", msg);
    return { error: msg };
  } finally {
    client.release();
  }
}

/** Reclasifica los anticipos de una factura recién contabilizada (hook post-venta). Best-effort. */
export async function reclasificarAnticiposDeFactura(schemaRaw: string, empresaId: string, facturaId: string, userId: string | null): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tP = quoteSchemaTable(schema, "pagos");
  const { rows } = await pool().query<{ id: string }>(
    `SELECT id FROM ${tP} WHERE empresa_id=$1::uuid AND factura_id=$2::uuid AND es_anticipo=true AND estado_contable='contabilizado'`,
    [empresaId, facturaId]
  );
  for (const r of rows) await reclasificarAnticipoPago(schema, empresaId, r.id, userId);
}

export interface SweepAnticiposResult { reclasificados: number; omitidos: number; errores: number; errores_detalle: string[] }

/** Backfill idempotente: reclasifica todo anticipo cuya factura ya tenga asiento de venta. */
export async function sweepReclasificarAnticipos(schemaRaw: string, empresaId: string, userId: string | null): Promise<SweepAnticiposResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tP = quoteSchemaTable(schema, "pagos");
  const tF = quoteSchemaTable(schema, "facturas");
  const { rows } = await pool().query<{ id: string }>(
    `SELECT p.id FROM ${tP} p JOIN ${tF} f ON f.id=p.factura_id
      WHERE p.empresa_id=$1::uuid AND p.es_anticipo=true AND p.estado_contable='contabilizado' AND f.estado_contable='contabilizado'`,
    [empresaId]
  );
  const res: SweepAnticiposResult = { reclasificados: 0, omitidos: 0, errores: 0, errores_detalle: [] };
  for (const r of rows) {
    const out = await reclasificarAnticipoPago(schema, empresaId, r.id, userId);
    if (out === "reclasificado") res.reclasificados++;
    else if (typeof out === "object") { res.errores++; res.errores_detalle.push(`${r.id}: ${out.error}`); }
    else res.omitidos++;
  }
  return res;
}
