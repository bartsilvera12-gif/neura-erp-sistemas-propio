import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

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
  created_at: string;
  updated_at: string;
}

const HEADER_COLS = `
  g.id, g.empresa_id, g.numero, g.estado, g.proveedor_id,
  g.categoria, g.descripcion, g.tipo_comprobante, g.numero_comprobante, g.timbrado,
  g.fecha_comprobante, g.fecha_contable, g.tipo_pago, g.plazo_dias, g.fecha_vencimiento,
  g.moneda, g.tipo_cambio, g.subtotal, g.monto_iva, g.total, g.monto, g.fecha,
  g.confirmado_at, g.anulado_at, g.motivo_anulacion, g.created_at, g.updated_at,
  p.nombre AS proveedor_nombre, p.ruc AS proveedor_ruc
`;

const IVA_RATE: Record<IvaTipo, number> = { exenta: 0, "5": 0.05, "10": 0.1 };

/** Calcula IVA aditivo de una línea (base gravada → +IVA). */
function calcItem(subtotalRaw: number, iva: IvaTipo) {
  const subtotal = Number.isFinite(subtotalRaw) ? subtotalRaw : 0;
  const monto_iva = subtotal * IVA_RATE[iva];
  return { subtotal, monto_iva, total_linea: subtotal + monto_iva };
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
    ],
    vals: [
      h.proveedor_id, h.descripcion, h.categoria, h.tipo_comprobante, h.numero_comprobante,
      h.timbrado, h.fecha_comprobante, h.fecha_contable, h.tipo_pago, h.plazo_dias,
      h.fecha_vencimiento, h.moneda, h.tipo_cambio, totals.subtotal, totals.monto_iva, totals.total, totals.total,
    ],
  };
}

export async function createBorrador(
  schemaRaw: string, empresaId: string, h: GastoHeaderInput, userId: string | null
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
    const a = headerAssignments(h, totals);
    const fechaFallback = h.fecha_comprobante ?? h.fecha_contable ?? null;
    void userId; // la cabecera de gastos no tiene created_by; el actor se registra al confirmar/anular
    const cols = [...a.cols, "estado", "tipo", "fecha"];
    const vals = [...a.vals, "borrador", "variable", fechaFallback];
    const ph = vals.map((_, i) => `$${i + 2}`);
    const { rows } = await client.query<GastoRow>(
      `INSERT INTO ${tG} (empresa_id, ${cols.join(", ")})
       VALUES ($1::uuid, ${ph.join(", ")})
       RETURNING id`,
      [empresaId, ...vals]
    );
    const gastoId = rows[0].id;
    await insertItems(client, tI, empresaId, gastoId, computed);
    await client.query("COMMIT");
    const full = await getGasto(schema, empresaId, gastoId);
    return full!.header;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
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
    throw e;
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
    throw e;
  } finally {
    client.release();
  }
}

/** Requisitos fiscales mínimos para confirmar y aparecer en el Libro de Compras. */
export function faltantesFiscales(h: {
  proveedor_id: string | null; tipo_comprobante: string | null;
  numero_comprobante: string | null; timbrado: string | null; fecha_comprobante: string | null;
}): string[] {
  const faltan: string[] = [];
  if (!h.proveedor_id) faltan.push("proveedor");
  if (!h.tipo_comprobante || !String(h.tipo_comprobante).trim()) faltan.push("tipo de comprobante");
  if (!h.numero_comprobante || !String(h.numero_comprobante).trim()) faltan.push("número de comprobante");
  if (!h.timbrado || !String(h.timbrado).trim()) faltan.push("timbrado");
  if (!h.fecha_comprobante) faltan.push("fecha de comprobante");
  return faltan;
}

export async function confirmarGasto(schemaRaw: string, empresaId: string, id: string, userId: string | null): Promise<GastoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tG = quoteSchemaTable(schema, "gastos");
  const tI = quoteSchemaTable(schema, "gasto_items");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: cur } = await client.query<GastoRow>(
      `SELECT g.id, g.estado, g.proveedor_id, g.tipo_comprobante, g.numero_comprobante, g.timbrado, g.fecha_comprobante
         FROM ${tG} g WHERE g.id = $1::uuid AND g.empresa_id = $2::uuid FOR UPDATE`,
      [id, empresaId]
    );
    if (!cur[0]) throw new GastoError("Documento no encontrado.", 404);
    if (cur[0].estado !== "borrador") throw new GastoError("Solo se pueden confirmar documentos en borrador.", 409);
    const faltan = faltantesFiscales(cur[0]);
    if (faltan.length > 0) throw new GastoError(`Faltan datos fiscales para confirmar: ${faltan.join(", ")}.`);
    const { rows: cnt } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${tI} WHERE gasto_id = $1::uuid AND empresa_id = $2::uuid`,
      [id, empresaId]
    );
    if (Number(cnt[0]?.n ?? 0) === 0) throw new GastoError("El documento no tiene líneas.");

    const { rows: num } = await client.query<{ numero: string }>(
      `SELECT neura.next_numero_gasto_empresa($1::uuid) AS numero`,
      [empresaId]
    );
    await client.query(
      `UPDATE ${tG} SET estado='confirmado', numero = COALESCE(numero, $3), confirmado_at = now(), confirmado_by = $4::uuid
        WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, empresaId, num[0].numero, userId]
    );
    await client.query("COMMIT");
    const full = await getGasto(schema, empresaId, id);
    return full!.header;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}

export async function anularGasto(schemaRaw: string, empresaId: string, id: string, motivo: string, userId: string | null): Promise<GastoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!motivo || motivo.trim().length < 3) throw new GastoError("El motivo de anulación es obligatorio (mín. 3 caracteres).");
  const tG = quoteSchemaTable(schema, "gastos");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ estado: string }>(
      `SELECT estado FROM ${tG} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [id, empresaId]
    );
    if (!rows[0]) throw new GastoError("Documento no encontrado.", 404);
    if (rows[0].estado !== "confirmado") throw new GastoError("Solo se pueden anular documentos confirmados.", 409);
    await client.query(
      `UPDATE ${tG} SET estado='anulado', anulado_at = now(), anulado_by = $3::uuid, motivo_anulacion = $4
        WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, empresaId, userId, motivo.trim()]
    );
    await client.query("COMMIT");
    const full = await getGasto(schema, empresaId, id);
    return full!.header;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Completar un histórico: rellena datos fiscales + líneas SIN sobrescribir los
 * datos originales (categoria/descripcion/monto/fecha se conservan) y lo pasa a
 * 'borrador' para que luego se confirme de forma explícita (nunca automática).
 */
export async function completarHistorico(schemaRaw: string, empresaId: string, id: string, h: GastoHeaderInput): Promise<GastoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  validateItems(h.items);
  await assertCuentasValidas(schema, empresaId, h.items.map((i) => i.cuenta_contable_id ?? "").filter(Boolean));
  const { computed, totals } = sumTotals(h.items);
  const tG = quoteSchemaTable(schema, "gastos");
  const tI = quoteSchemaTable(schema, "gasto_items");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ estado: string }>(
      `SELECT estado FROM ${tG} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [id, empresaId]
    );
    if (!rows[0]) throw new GastoError("Documento no encontrado.", 404);
    if (rows[0].estado !== "historico") throw new GastoError("Solo aplica a documentos históricos.", 409);
    // Rellena SOLO campos fiscales nuevos; NO toca categoria/descripcion/monto/tipo/fecha originales.
    const a = headerAssignments({ ...h, categoria: null, descripcion: null }, totals);
    // Excluir categoria/descripcion/monto para no pisar el histórico original.
    const skip = new Set(["categoria", "descripcion", "monto"]);
    const kept = a.cols.map((c, i) => ({ c, v: a.vals[i] })).filter((x) => !skip.has(x.c));
    const setSql = kept.map((x, i) => `${x.c} = $${i + 3}`).join(", ");
    await client.query(
      `UPDATE ${tG} SET ${setSql}, estado='borrador' WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, empresaId, ...kept.map((x) => x.v)]
    );
    await client.query(`DELETE FROM ${tI} WHERE gasto_id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
    await insertItems(client, tI, empresaId, id, computed);
    await client.query("COMMIT");
    const full = await getGasto(schema, empresaId, id);
    return full!.header;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}
