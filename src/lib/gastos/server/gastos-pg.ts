import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import {
  getConfigContable, construirLineasDocumento, generarAsientoEnTx, getAsientoConDetalles, ContabilidadError,
} from "@/lib/contabilidad/asientos-pg";

/**
 * Gastos y Servicios — capa PG directa (transaccional), mismo patrón que compras-pg.
 * Regla fiscal única (idéntica a Compras/Fase 0): el importe de cada línea es la BASE
 * GRAVADA (neto, sin IVA); el IVA se calcula y se SUMA. No es IVA incluido.
 */

export type GastoEstado = "borrador" | "confirmado" | "anulado" | "historico";
export type IvaTipo = "exenta" | "5" | "10";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export class GastoError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface GastoItemInput {
  descripcion: string;
  cuenta_contable_id: string | null;
  subtotal: number;
  iva_tipo: IvaTipo;
}

export interface GastoHeaderInput {
  proveedor_id: string | null;
  descripcion: string | null;
  categoria: string | null;
  tipo_comprobante: string | null;
  numero_comprobante: string | null;
  timbrado: string | null;
  fecha_comprobante: string | null;
  fecha_contable: string | null;
  tipo_pago: "contado" | "credito" | null;
  plazo_dias: number | null;
  fecha_vencimiento: string | null;
  moneda: string | null;
  tipo_cambio: number | null;
  /** Cuenta de pago (contrapartida) para operaciones al contado. */
  cuenta_contrapartida_id: string | null;
  items: GastoItemInput[];
}

function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Normaliza el body del request a un GastoHeaderInput validado en tipos básicos. */
export function parseGastoHeaderInput(body: unknown): GastoHeaderInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
  const items: GastoItemInput[] = rawItems.map((it) => ({
    descripcion: String(it.descripcion ?? "").trim(),
    cuenta_contable_id: txt(it.cuenta_contable_id),
    subtotal: Number(it.subtotal) || 0,
    iva_tipo: (["exenta", "5", "10"].includes(String(it.iva_tipo)) ? String(it.iva_tipo) : "exenta") as IvaTipo,
  }));
  const tipoPagoRaw = txt(b.tipo_pago);
  return {
    proveedor_id: txt(b.proveedor_id),
    descripcion: txt(b.descripcion),
    categoria: txt(b.categoria),
    tipo_comprobante: txt(b.tipo_comprobante),
    numero_comprobante: txt(b.numero_comprobante),
    timbrado: txt(b.timbrado),
    fecha_comprobante: txt(b.fecha_comprobante),
    fecha_contable: txt(b.fecha_contable),
    tipo_pago: tipoPagoRaw === "credito" ? "credito" : tipoPagoRaw === "contado" ? "contado" : null,
    plazo_dias: b.plazo_dias != null && String(b.plazo_dias).trim() !== "" ? parseInt(String(b.plazo_dias), 10) || null : null,
    fecha_vencimiento: txt(b.fecha_vencimiento),
    moneda: txt(b.moneda) ?? "PYG",
    tipo_cambio: b.tipo_cambio != null && String(b.tipo_cambio).trim() !== "" ? Number(b.tipo_cambio) || null : null,
    cuenta_contrapartida_id: txt(b.cuenta_contrapartida_id),
    items,
  };
}

export interface GastoItemRow {
  id: string;
  gasto_id: string;
  descripcion: string;
  cuenta_contable_id: string | null;
  cuenta_codigo: string | null;
  cuenta_denominacion: string | null;
  subtotal: string | number;
  iva_tipo: string;
  monto_iva: string | number;
  total_linea: string | number;
}

export interface GastoRow {
  id: string;
  empresa_id: string;
  numero: string | null;
  estado: GastoEstado;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  proveedor_ruc: string | null;
  categoria: string | null;
  descripcion: string | null;
  tipo_comprobante: string | null;
  numero_comprobante: string | null;
  timbrado: string | null;
  fecha_comprobante: string | null;
  fecha_contable: string | null;
  tipo_pago: string | null;
  plazo_dias: number | null;
  fecha_vencimiento: string | null;
  moneda: string | null;
  tipo_cambio: string | number | null;
  subtotal: string | number | null;
  monto_iva: string | number | null;
  total: string | number | null;
  monto: string | number | null;
  fecha: string | null;
  confirmado_at: string | null;
  anulado_at: string | null;
  motivo_anulacion: string | null;
  estado_contable: string | null;
  asiento_contable_id: string | null;
  cuenta_contrapartida_id: string | null;
  created_at: string;
  updated_at: string;
}

const HEADER_COLS = `
  g.id, g.empresa_id, g.numero, g.estado, g.proveedor_id,
  g.categoria, g.descripcion, g.tipo_comprobante, g.numero_comprobante, g.timbrado,
  g.fecha_comprobante, g.fecha_contable, g.tipo_pago, g.plazo_dias, g.fecha_vencimiento,
  g.moneda, g.tipo_cambio, g.subtotal, g.monto_iva, g.total, g.monto, g.fecha,
  g.confirmado_at, g.anulado_at, g.motivo_anulacion,
  g.estado_contable, g.asiento_contable_id, g.cuenta_contrapartida_id,
  g.created_at, g.updated_at,
  p.nombre AS proveedor_nombre, p.ruc AS proveedor_ruc
`;

// IVA INCLUIDO (Paraguay): el monto ingresado es el total (con IVA); el IVA se DEDUCE.
const IVA_FACTOR_INCL: Record<IvaTipo, number> = { exenta: 0, "5": 5 / 105, "10": 10 / 110 };

/** Deduce el IVA incluido de una línea: base = monto − IVA; total de línea = monto ingresado. */
function calcItem(montoRaw: number, iva: IvaTipo) {
  const monto = Number.isFinite(montoRaw) ? montoRaw : 0; // total con IVA
  const monto_iva = Math.round(monto * IVA_FACTOR_INCL[iva]);
  return { subtotal: monto - monto_iva, monto_iva, total_linea: monto };
}

function validateItems(items: GastoItemInput[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new GastoError("El documento debe tener al menos una línea.");
  }
  for (const it of items) {
    if (!it.descripcion || !String(it.descripcion).trim()) {
      throw new GastoError("Cada línea requiere una descripción.");
    }
    if (!(["exenta", "5", "10"] as string[]).includes(String(it.iva_tipo))) {
      throw new GastoError("Tipo de IVA inválido en una línea (exenta, 5 o 10).");
    }
    if (!Number.isFinite(Number(it.subtotal)) || Number(it.subtotal) < 0) {
      throw new GastoError("El importe de cada línea debe ser un número ≥ 0.");
    }
  }
}

/** Verifica que las cuentas usadas existan, sean de la empresa, activas y asentables. */
async function assertCuentasValidas(schema: string, empresaId: string, ids: string[]): Promise<void> {
  const uniq = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (uniq.length === 0) return;
  const tPC = quoteSchemaTable(schema, "plan_cuentas");
  const { rows } = await pool().query<{ id: string }>(
    `SELECT id FROM ${tPC}
      WHERE empresa_id = $1::uuid AND activo = true AND asentable = true AND id = ANY($2::uuid[])`,
    [empresaId, uniq]
  );
  const ok = new Set(rows.map((r) => r.id));
  const bad = uniq.filter((id) => !ok.has(id));
  if (bad.length > 0) {
    throw new GastoError("Una o más cuentas contables no son válidas (deben estar activas y ser asentables).");
  }
}

export interface GastoFilters {
  estado?: string;
  proveedor_id?: string;
  desde?: string;
  hasta?: string;
}

export async function listGastos(schemaRaw: string, empresaId: string, f: GastoFilters = {}): Promise<GastoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tG = quoteSchemaTable(schema, "gastos");
  const tP = quoteSchemaTable(schema, "proveedores");
  const where: string[] = ["g.empresa_id = $1::uuid"];
  const params: unknown[] = [empresaId];
  if (f.estado) { params.push(f.estado); where.push(`g.estado = $${params.length}`); }
  if (f.proveedor_id) { params.push(f.proveedor_id); where.push(`g.proveedor_id = $${params.length}::uuid`); }
  if (f.desde) { params.push(f.desde); where.push(`COALESCE(g.fecha_comprobante, g.fecha) >= $${params.length}::date`); }
  if (f.hasta) { params.push(f.hasta); where.push(`COALESCE(g.fecha_comprobante, g.fecha) <= $${params.length}::date`); }
  const { rows } = await pool().query<GastoRow>(
    `SELECT ${HEADER_COLS} FROM ${tG} g LEFT JOIN ${tP} p ON p.id = g.proveedor_id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(g.fecha_comprobante, g.fecha, g.created_at::date) DESC, g.created_at DESC
      LIMIT 1000`,
    params
  );
  return rows;
}

export async function getGasto(schemaRaw: string, empresaId: string, id: string): Promise<{ header: GastoRow; items: GastoItemRow[] } | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tG = quoteSchemaTable(schema, "gastos");
  const tP = quoteSchemaTable(schema, "proveedores");
  const tI = quoteSchemaTable(schema, "gasto_items");
  const tPC = quoteSchemaTable(schema, "plan_cuentas");
  const { rows: hRows } = await pool().query<GastoRow>(
    `SELECT ${HEADER_COLS} FROM ${tG} g LEFT JOIN ${tP} p ON p.id = g.proveedor_id
      WHERE g.empresa_id = $1::uuid AND g.id = $2::uuid`,
    [empresaId, id]
  );
  if (!hRows[0]) return null;
  const { rows: items } = await pool().query<GastoItemRow>(
    `SELECT i.id, i.gasto_id, i.descripcion, i.cuenta_contable_id,
            pc.cuenta AS cuenta_codigo, pc.denominacion AS cuenta_denominacion,
            i.subtotal, i.iva_tipo, i.monto_iva, i.total_linea
       FROM ${tI} i LEFT JOIN ${tPC} pc ON pc.id = i.cuenta_contable_id
      WHERE i.empresa_id = $1::uuid AND i.gasto_id = $2::uuid
      ORDER BY i.created_at ASC`,
    [empresaId, id]
  );
  return { header: hRows[0], items };
}

interface HeaderTotals { subtotal: number; monto_iva: number; total: number }
function sumTotals(items: GastoItemInput[]): { computed: Array<GastoItemInput & HeaderTotals>; totals: HeaderTotals } {
  let subtotal = 0, monto_iva = 0, total = 0;
  const computed = items.map((it) => {
    const c = calcItem(Number(it.subtotal), it.iva_tipo);
    subtotal += c.subtotal; monto_iva += c.monto_iva; total += c.total_linea;
    return { ...it, subtotal: c.subtotal, monto_iva: c.monto_iva, total: c.total_linea };
  });
  return { computed, totals: { subtotal, monto_iva, total } };
}

async function insertItems(
  client: import("pg").PoolClient, tI: string, empresaId: string, gastoId: string,
  computed: Array<GastoItemInput & HeaderTotals>
): Promise<void> {
  for (const it of computed) {
    await client.query(
      `INSERT INTO ${tI} (empresa_id, gasto_id, descripcion, cuenta_contable_id, subtotal, iva_tipo, monto_iva, total_linea)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::numeric, $6, $7::numeric, $8::numeric)`,
      [empresaId, gastoId, it.descripcion.trim(), it.cuenta_contable_id, it.subtotal, it.iva_tipo, it.monto_iva, it.total]
    );
  }
}

/** Columnas de cabecera comunes en INSERT/UPDATE (fiscales). */
function headerAssignments(h: GastoHeaderInput, totals: HeaderTotals) {
  return {
    cols: [
      "proveedor_id", "descripcion", "categoria", "tipo_comprobante", "numero_comprobante",
      "timbrado", "fecha_comprobante", "fecha_contable", "tipo_pago", "plazo_dias",
      "fecha_vencimiento", "moneda", "tipo_cambio", "subtotal", "monto_iva", "total", "monto",
      "cuenta_contrapartida_id",
    ],
    vals: [
      h.proveedor_id, h.descripcion, h.categoria, h.tipo_comprobante, h.numero_comprobante,
      h.timbrado, h.fecha_comprobante, h.fecha_contable, h.tipo_pago, h.plazo_dias,
      h.fecha_vencimiento, h.moneda, h.tipo_cambio, totals.subtotal, totals.monto_iva, totals.total, totals.total,
      h.cuenta_contrapartida_id,
    ],
  };
}

/** Timbrado exigido salvo comprobantes que no lo llevan (Recibo, Otro). */
function requiereTimbrado(tipo: string | null): boolean {
  const t = (tipo ?? "").trim().toLowerCase();
  return !(t === "" || t === "recibo" || t === "otro");
}

/** Validación estricta de líneas para confirmar (cuenta + descripción + monto > 0 + IVA). */
function validateItemsForConfirm(items: GastoItemInput[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new GastoError("El documento debe tener al menos una línea.");
  }
  for (const it of items) {
    if (!it.descripcion || !String(it.descripcion).trim()) throw new GastoError("Cada línea requiere una descripción.");
    if (!it.cuenta_contable_id) throw new GastoError("Cada línea requiere una cuenta contable.");
    if (!(["exenta", "5", "10"] as string[]).includes(String(it.iva_tipo))) throw new GastoError("Tipo de IVA inválido en una línea (exenta, 5 o 10).");
    if (!(Number(it.subtotal) > 0)) throw new GastoError("El monto de cada línea debe ser mayor que cero.");
  }
}

async function fetchGastoIdByIdempotency(schema: string, empresaId: string, key: string): Promise<string | null> {
  const tG = quoteSchemaTable(schema, "gastos");
  const { rows } = await pool().query<{ id: string }>(
    `SELECT id FROM ${tG} WHERE empresa_id = $1::uuid AND idempotency_key = $2::uuid LIMIT 1`,
    [empresaId, key]
  );
  return rows[0]?.id ?? null;
}

export interface ConfirmarDirectoOpts {
  id?: string | null;
  header: GastoHeaderInput;
  userId: string | null;
  idempotencyKey?: string | null;
}

/**
 * Guarda y CONFIRMA en un solo paso atómico (sin borrador intermedio).
 *  - Sin `id`: crea la cabecera confirmada (idempotente por `idempotencyKey`).
 *  - `id` en 'borrador': actualiza + confirma.
 *  - `id` en 'historico': completa (sin pisar categoria/descripcion/monto originales) + confirma.
 * Reserva el correlativo GS dentro de la transacción; cualquier fallo hace ROLLBACK total
 * (sin cabecera ni líneas parciales, sin consumir número).
 */
export async function confirmarDirecto(schemaRaw: string, empresaId: string, opts: ConfirmarDirectoOpts): Promise<GastoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const h = opts.header;
  const id = opts.id ?? null;
  const idem = opts.idempotencyKey ?? null;
  const userId = opts.userId;

  const faltan = faltantesFiscales(h);
  if (faltan.length > 0) throw new GastoError(`Faltan datos para confirmar: ${faltan.join(", ")}.`);
  validateItemsForConfirm(h.items);
  await assertCuentasValidas(schema, empresaId, h.items.map((i) => i.cuenta_contable_id ?? "").filter(Boolean));
  const { computed, totals } = sumTotals(h.items);

  const tG = quoteSchemaTable(schema, "gastos");
  const tI = quoteSchemaTable(schema, "gasto_items");

  // Idempotencia (solo alta nueva): un doble-envío devuelve el gasto ya creado.
  if (!id && idem) {
    const existingId = await fetchGastoIdByIdempotency(schema, empresaId, idem);
    if (existingId) return (await getGasto(schema, empresaId, existingId))!.header;
  }

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    let gastoId = "";
    let preserveHistorico = false;

    if (id) {
      const { rows } = await client.query<{ estado: string }>(
        `SELECT estado FROM ${tG} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
        [id, empresaId]
      );
      if (!rows[0]) throw new GastoError("Documento no encontrado.", 404);
      const est = rows[0].estado;
      if (est !== "borrador" && est !== "historico") throw new GastoError("Solo se pueden confirmar borradores o históricos.", 409);
      preserveHistorico = est === "historico";
      gastoId = id;
    }

    // Reserva del correlativo DENTRO de la transacción (un rollback lo revierte).
    const { rows: num } = await client.query<{ numero: string }>(
      `SELECT neura.next_numero_gasto_empresa($1::uuid) AS numero`, [empresaId]
    );
    const numero = num[0].numero;

    const a = headerAssignments(h, totals);
    if (id) {
      let cols = a.cols, vals = a.vals;
      if (preserveHistorico) {
        const skip = new Set(["categoria", "descripcion", "monto"]);
        const kept = a.cols.map((c, i) => ({ c, v: a.vals[i] })).filter((x) => !skip.has(x.c));
        cols = kept.map((x) => x.c); vals = kept.map((x) => x.v);
      }
      const setSql = cols.map((c, i) => `${c} = $${i + 3}`).join(", ");
      const p = cols.length + 3;
      await client.query(
        `UPDATE ${tG} SET ${setSql}, estado='confirmado', numero = $${p}, confirmado_at = now(), confirmado_by = $${p + 1}::uuid
          WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [id, empresaId, ...vals, numero, userId]
      );
      await client.query(`DELETE FROM ${tI} WHERE gasto_id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
    } else {
      const fechaFallback = h.fecha_comprobante ?? h.fecha_contable ?? null;
      const cols = [...a.cols, "estado", "tipo", "fecha", "numero", "confirmado_by", "idempotency_key"];
      const vals = [...a.vals, "confirmado", "variable", fechaFallback, numero, userId, idem];
      const ph = vals.map((_, i) => `$${i + 2}`);
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO ${tG} (empresa_id, ${cols.join(", ")}, confirmado_at) VALUES ($1::uuid, ${ph.join(", ")}, now()) RETURNING id`,
          [empresaId, ...vals]
        );
        gastoId = rows[0].id;
      } catch (insErr) {
        const code = (insErr as { code?: string })?.code;
        const constraint = String((insErr as { constraint?: string })?.constraint ?? "");
        if (code === "23505" && constraint.includes("idempotency") && idem) {
          await client.query("ROLLBACK").catch(() => null);
          const existingId = await fetchGastoIdByIdempotency(schema, empresaId, idem);
          if (existingId) return (await getGasto(schema, empresaId, existingId))!.header;
        }
        throw insErr;
      }
    }

    await insertItems(client, tI, empresaId, gastoId, computed);

    // Asiento contable balanceado, dentro de la MISMA transacción (rollback total si falla).
    const config = await getConfigContable(schema, empresaId);
    const esContado = h.tipo_pago !== "credito";
    const lineasFiscales = computed.map((it) => ({
      cuenta_contable_id: it.cuenta_contable_id as string,
      descripcion: it.descripcion,
      subtotal: it.subtotal,
      iva_tipo: it.iva_tipo,
      monto_iva: it.monto_iva,
    }));
    const lineasAsiento = construirLineasDocumento({
      config, lineasFiscales, total: totals.total, esContado,
      contrapartidaContado: h.cuenta_contrapartida_id, proveedorId: h.proveedor_id,
      documento_tipo: "gasto", documento_id: gastoId,
    });
    const asiento = await generarAsientoEnTx(client, schema, empresaId, {
      origen_tipo: "gasto_servicio", origen_id: gastoId, evento_origen: "confirmacion",
      fecha_contable: (h.fecha_contable ?? h.fecha_comprobante) as string,
      glosa: `Gasto y Servicio ${numero}`, moneda: h.moneda ?? "PYG", tipo_cambio: h.tipo_cambio ?? 1,
      lineas: lineasAsiento, createdBy: userId,
    });
    await client.query(
      `UPDATE ${tG} SET estado_contable='contabilizado', asiento_contable_id = $3::uuid WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [gastoId, empresaId, asiento.id]
    );

    await client.query("COMMIT");
    return (await getGasto(schema, empresaId, gastoId))!.header;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e instanceof ContabilidadError ? new GastoError(e.message, e.status) : e;
  } finally {
    client.release();
  }
}

export async function updateBorrador(
  schemaRaw: string, empresaId: string, id: string, h: GastoHeaderInput
): Promise<GastoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  validateItems(h.items);
  await assertCuentasValidas(schema, empresaId, h.items.map((i) => i.cuenta_contable_id ?? "").filter(Boolean));
  const { computed, totals } = sumTotals(h.items);
  const tG = quoteSchemaTable(schema, "gastos");
  const tI = quoteSchemaTable(schema, "gasto_items");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: cur } = await client.query<{ estado: string }>(
      `SELECT estado FROM ${tG} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [id, empresaId]
    );
    if (!cur[0]) throw new GastoError("Documento no encontrado.", 404);
    if (cur[0].estado !== "borrador") throw new GastoError("Solo se pueden editar documentos en borrador.", 409);

    const a = headerAssignments(h, totals);
    const setSql = a.cols.map((c, i) => `${c} = $${i + 3}`).join(", ");
    await client.query(
      `UPDATE ${tG} SET ${setSql}, fecha = COALESCE($${a.cols.length + 3}, fecha)
        WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, empresaId, ...a.vals, h.fecha_comprobante ?? h.fecha_contable ?? null]
    );
    await client.query(`DELETE FROM ${tI} WHERE gasto_id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
    await insertItems(client, tI, empresaId, id, computed);
    await client.query("COMMIT");
    const full = await getGasto(schema, empresaId, id);
    return full!.header;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e instanceof ContabilidadError ? new GastoError(e.message, e.status) : e;
  } finally {
    client.release();
  }
}

export async function deleteBorrador(schemaRaw: string, empresaId: string, id: string): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tG = quoteSchemaTable(schema, "gastos");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ estado: string }>(
      `SELECT estado FROM ${tG} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [id, empresaId]
    );
    if (!rows[0]) throw new GastoError("Documento no encontrado.", 404);
    if (rows[0].estado !== "borrador") throw new GastoError("Solo se pueden eliminar documentos en borrador.", 409);
    await client.query(`DELETE FROM ${tG} WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e instanceof ContabilidadError ? new GastoError(e.message, e.status) : e;
  } finally {
    client.release();
  }
}

/** Requisitos fiscales mínimos para confirmar y aparecer en el Libro de Compras. */
export function faltantesFiscales(h: {
  proveedor_id: string | null; tipo_comprobante: string | null; numero_comprobante: string | null;
  timbrado: string | null; fecha_comprobante: string | null; fecha_contable: string | null; tipo_pago: string | null;
}): string[] {
  const faltan: string[] = [];
  const has = (v: string | null) => !!v && String(v).trim() !== "";
  if (!h.proveedor_id) faltan.push("proveedor");
  if (!has(h.tipo_comprobante)) faltan.push("tipo de comprobante");
  if (!has(h.numero_comprobante)) faltan.push("número de comprobante");
  if (!h.fecha_comprobante) faltan.push("fecha de comprobante");
  if (!h.fecha_contable) faltan.push("fecha contable");
  if (!has(h.tipo_pago)) faltan.push("condición");
  if (requiereTimbrado(h.tipo_comprobante) && !has(h.timbrado)) faltan.push("timbrado");
  return faltan;
}

export async function anularGasto(schemaRaw: string, empresaId: string, id: string, motivo: string, userId: string | null): Promise<GastoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!motivo || motivo.trim().length < 3) throw new GastoError("El motivo de anulación es obligatorio (mín. 3 caracteres).");
  const tG = quoteSchemaTable(schema, "gastos");
  const tA = quoteSchemaTable(schema, "asientos_contables");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ estado: string; estado_contable: string; asiento_contable_id: string | null; numero: string | null }>(
      `SELECT estado, estado_contable, asiento_contable_id, numero FROM ${tG} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [id, empresaId]
    );
    if (!rows[0]) throw new GastoError("Documento no encontrado.", 404);
    if (rows[0].estado !== "confirmado") throw new GastoError("Solo se pueden anular documentos confirmados.", 409);

    let estadoContable = "no_contabilizado";
    // Reversión contable: crea un asiento inverso y marca el original como revertido.
    if (rows[0].estado_contable === "contabilizado" && rows[0].asiento_contable_id) {
      const orig = await getAsientoConDetalles(client, schema, empresaId, rows[0].asiento_contable_id);
      if (orig) {
        const revLineas = orig.detalles.map((d) => ({
          cuenta_contable_id: d.cuenta_contable_id,
          proveedor_id: d.proveedor_id ?? null,
          descripcion: `Reversión: ${d.descripcion ?? ""}`.trim(),
          debe: Number(d.haber) || 0,
          haber: Number(d.debe) || 0,
          documento_tipo: d.documento_tipo ?? null,
          documento_id: d.documento_id ?? null,
        }));
        const rev = await generarAsientoEnTx(client, schema, empresaId, {
          origen_tipo: "reversion", origen_id: id, evento_origen: "reversion",
          fecha_contable: String(orig.cabecera.fecha_contable).slice(0, 10),
          glosa: `Reversión Gasto y Servicio ${rows[0].numero ?? ""}`.trim(),
          moneda: orig.cabecera.moneda, tipo_cambio: Number(orig.cabecera.tipo_cambio) || 1,
          lineas: revLineas, createdBy: userId, asiento_original_id: rows[0].asiento_contable_id,
        });
        await client.query(
          `UPDATE ${tA} SET estado='revertido', asiento_reversion_id = $2::uuid WHERE id = $1::uuid`,
          [rows[0].asiento_contable_id, rev.id]
        );
        estadoContable = "revertido";
      }
    }

    await client.query(
      `UPDATE ${tG} SET estado='anulado', estado_contable = $5, anulado_at = now(), anulado_by = $3::uuid, motivo_anulacion = $4
        WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, empresaId, userId, motivo.trim(), estadoContable]
    );
    await client.query("COMMIT");
    const full = await getGasto(schema, empresaId, id);
    return full!.header;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e instanceof ContabilidadError ? new GastoError(e.message, e.status) : e;
  } finally {
    client.release();
  }
}

