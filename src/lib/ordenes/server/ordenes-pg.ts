import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/**
 * Órdenes de Compra — documento de intención. NO afecta inventario, NO genera
 * deuda, NO genera asiento y NO aparece en libros contables. Solo habilita el
 * circuito Recepciones → Compras.
 */

export class OrdenError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type OrdenEstado = "borrador" | "aprobada" | "parcialmente_recibida" | "recibida" | "cerrada" | "cancelada";
export type IvaTipo = "exenta" | "5" | "10";

export interface OrdenItemInput {
  producto_id: string | null;
  producto_nombre: string;
  descripcion: string | null;
  cantidad: number;
  costo_unitario_estimado: number;
  iva_tipo: IvaTipo;
  cuenta_contable_id: string | null;
}

export interface OrdenInput {
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  fecha_estimada: string | null;
  observaciones: string | null;
  moneda: string;
  tipo_cambio: number;
  items: OrdenItemInput[];
  idempotency_key: string | null;
  created_by: string | null;
  usuario_nombre: string | null;
}

export interface OrdenRow {
  id: string; numero: string; proveedor_id: string; proveedor_nombre: string | null;
  fecha: string; fecha_estimada: string | null; observaciones: string | null;
  moneda: string; tipo_cambio: string | number; total_estimado: string | number;
  estado: OrdenEstado; motivo_cierre: string | null; motivo_cancelacion: string | null;
  cerrada_at: string | null; cancelada_at: string | null; aprobada_at: string | null;
  usuario_nombre: string | null; created_at: string;
  /** Progreso agregado (solo en list/get). */
  cant_solicitada?: number; cant_recibida?: number; cant_pendiente?: number;
  cant_facturada?: number; cant_pend_facturar?: number;
}

const OC_COLS = `o.id, o.numero, o.proveedor_id, o.proveedor_nombre, o.fecha, o.fecha_estimada,
  o.observaciones, o.moneda, o.tipo_cambio, o.total_estimado, o.estado, o.motivo_cierre,
  o.motivo_cancelacion, o.cerrada_at, o.cancelada_at, o.aprobada_at, o.usuario_nombre, o.created_at`;

/**
 * Subconsulta de progreso por orden: solicitado / recibido / facturado.
 * - recibido  = Σ recepcion_items de recepciones confirmadas.
 * - facturado = Σ compra_items ligados a esos recepcion_items (cantidad_facturada).
 */
function progresoCTE(schema: string): string {
  const tOCI = quoteSchemaTable(schema, "orden_compra_items");
  const tR = quoteSchemaTable(schema, "recepciones");
  const tRI = quoteSchemaTable(schema, "recepcion_items");
  return `
    prog AS (
      SELECT i.orden_id,
             SUM(i.cantidad) AS solicitada,
             COALESCE(SUM(rec.recibida), 0) AS recibida,
             COALESCE(SUM(rec.facturada), 0) AS facturada
        FROM ${tOCI} i
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(ri.cantidad_recibida), 0) AS recibida,
                 COALESCE(SUM(ri.cantidad_facturada), 0) AS facturada
            FROM ${tRI} ri
            JOIN ${tR} r ON r.id = ri.recepcion_id AND r.estado = 'confirmada'
           WHERE ri.orden_item_id = i.id
        ) rec ON true
       GROUP BY i.orden_id
    )`;
}

function mapProgreso(r: Record<string, unknown>): OrdenRow {
  const solicitada = Number(r.solicitada) || 0;
  const recibida = Number(r.recibida) || 0;
  const facturada = Number(r.facturada) || 0;
  return {
    ...(r as unknown as OrdenRow),
    cant_solicitada: solicitada,
    cant_recibida: recibida,
    cant_pendiente: Math.max(0, solicitada - recibida),
    cant_facturada: facturada,
    cant_pend_facturar: Math.max(0, recibida - facturada),
  };
}

export async function listOrdenes(
  schemaRaw: string,
  empresaId: string,
  f: { estado?: string | null; proveedor_id?: string | null; desde?: string | null; hasta?: string | null } = {}
): Promise<OrdenRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tO = quoteSchemaTable(schema, "ordenes_compra");
  const params: unknown[] = [empresaId];
  const where: string[] = ["o.empresa_id = $1::uuid"];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.estado) where.push(`o.estado = ${add(f.estado)}`);
  if (f.proveedor_id) where.push(`o.proveedor_id = ${add(f.proveedor_id)}::uuid`);
  if (f.desde) where.push(`o.fecha >= ${add(f.desde)}::date`);
  if (f.hasta) where.push(`o.fecha <= ${add(f.hasta)}::date`);

  const { rows } = await pool().query(
    `WITH ${progresoCTE(schema)}
     SELECT ${OC_COLS}, p.solicitada, p.recibida, p.facturada
       FROM ${tO} o LEFT JOIN prog p ON p.orden_id = o.id
      WHERE ${where.join(" AND ")}
      ORDER BY o.fecha DESC, o.numero DESC LIMIT 500`,
    params
  );
  return rows.map(mapProgreso);
}

export interface OrdenItemRow {
  id: string; producto_id: string | null; producto_nombre: string | null; descripcion: string | null;
  cantidad: string | number; costo_unitario_estimado: string | number; iva_tipo: string;
  cuenta_contable_id: string | null; orden_linea: number;
  recibida: string | number; facturada: string | number;
}

export async function getOrden(
  schemaRaw: string, empresaId: string, ordenId: string
): Promise<{ orden: OrdenRow; items: OrdenItemRow[]; tiene_recepciones: boolean } | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tO = quoteSchemaTable(schema, "ordenes_compra");
  const tOCI = quoteSchemaTable(schema, "orden_compra_items");
  const tR = quoteSchemaTable(schema, "recepciones");
  const tRI = quoteSchemaTable(schema, "recepcion_items");

  const { rows } = await pool().query(
    `WITH ${progresoCTE(schema)}
     SELECT ${OC_COLS}, p.solicitada, p.recibida, p.facturada
       FROM ${tO} o LEFT JOIN prog p ON p.orden_id = o.id
      WHERE o.id = $1::uuid AND o.empresa_id = $2::uuid`,
    [ordenId, empresaId]
  );
  if (!rows[0]) return null;

  const { rows: items } = await pool().query<OrdenItemRow>(
    `SELECT i.id, i.producto_id, i.producto_nombre, i.descripcion, i.cantidad,
            i.costo_unitario_estimado, i.iva_tipo, i.cuenta_contable_id, i.orden_linea,
            COALESCE(rec.recibida, 0) AS recibida, COALESCE(rec.facturada, 0) AS facturada
       FROM ${tOCI} i
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(ri.cantidad_recibida),0) AS recibida,
                COALESCE(SUM(ri.cantidad_facturada),0) AS facturada
           FROM ${tRI} ri JOIN ${tR} r ON r.id = ri.recepcion_id AND r.estado='confirmada'
          WHERE ri.orden_item_id = i.id
       ) rec ON true
      WHERE i.orden_id = $1::uuid AND i.empresa_id = $2::uuid
      ORDER BY i.orden_linea`,
    [ordenId, empresaId]
  );

  const { rows: rc } = await pool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${tR} WHERE orden_id = $1::uuid AND empresa_id = $2::uuid AND estado='confirmada'`,
    [ordenId, empresaId]
  );

  return { orden: mapProgreso(rows[0]), items, tiene_recepciones: Number(rc[0]?.n ?? 0) > 0 };
}

function validarItems(items: OrdenItemInput[]): void {
  if (!Array.isArray(items) || items.length === 0) throw new OrdenError("La orden requiere al menos un ítem.");
  for (const [i, it] of items.entries()) {
    if (!(Number(it.cantidad) > 0)) throw new OrdenError(`Ítem ${i + 1}: la cantidad debe ser mayor a 0.`);
    if (Number(it.costo_unitario_estimado) < 0) throw new OrdenError(`Ítem ${i + 1}: el costo no puede ser negativo.`);
    if (!["exenta", "5", "10"].includes(it.iva_tipo)) throw new OrdenError(`Ítem ${i + 1}: tipo de IVA inválido.`);
    if (!it.producto_id && !String(it.descripcion ?? "").trim() && !String(it.producto_nombre ?? "").trim()) {
      throw new OrdenError(`Ítem ${i + 1}: indicá un producto o una descripción.`);
    }
  }
}

const totalEstimado = (items: OrdenItemInput[]) =>
  items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.costo_unitario_estimado) || 0), 0);

async function fetchByIdem(schema: string, empresaId: string, key: string): Promise<OrdenRow | null> {
  const tO = quoteSchemaTable(schema, "ordenes_compra");
  const { rows } = await pool().query(
    `SELECT ${OC_COLS} FROM ${tO} o WHERE o.empresa_id = $1::uuid AND o.idempotency_key = $2::uuid LIMIT 1`,
    [empresaId, key]
  );
  return (rows[0] as OrdenRow) ?? null;
}

/** Crea la orden (estado borrador) con sus ítems, en una transacción. Idempotente. */
export async function createOrden(schemaRaw: string, empresaId: string, d: OrdenInput): Promise<OrdenRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  validarItems(d.items);
  if (d.idempotency_key) {
    const ex = await fetchByIdem(schema, empresaId, d.idempotency_key);
    if (ex) return ex;
  }
  const tO = quoteSchemaTable(schema, "ordenes_compra");
  const tI = quoteSchemaTable(schema, "orden_compra_items");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: num } = await client.query<{ numero: string }>(
      `SELECT neura.next_numero_orden_empresa($1::uuid) AS numero`, [empresaId]
    );
    let orden: OrdenRow;
    try {
      const { rows } = await client.query(
        `INSERT INTO ${tO} (empresa_id, numero, proveedor_id, proveedor_nombre, fecha, fecha_estimada,
           observaciones, moneda, tipo_cambio, total_estimado, estado, idempotency_key, created_by, usuario_nombre)
         VALUES ($1::uuid,$2,$3::uuid,$4,$5::date,$6::date,$7,$8,$9::numeric,$10::numeric,'borrador',$11::uuid,$12::uuid,$13)
         RETURNING ${OC_COLS.replace(/o\./g, "")}`,
        [empresaId, num[0].numero, d.proveedor_id, d.proveedor_nombre, d.fecha, d.fecha_estimada || null,
         d.observaciones, d.moneda, d.tipo_cambio, totalEstimado(d.items), d.idempotency_key,
         d.created_by, d.usuario_nombre]
      );
      orden = rows[0] as OrdenRow;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "23505" && String((e as { constraint?: string })?.constraint ?? "").includes("idem") && d.idempotency_key) {
        await client.query("ROLLBACK").catch(() => null);
        const ex = await fetchByIdem(schema, empresaId, d.idempotency_key);
        if (ex) return ex;
      }
      throw e;
    }
    await insertItems(client, tI, empresaId, orden.id, d.items);
    await client.query("COMMIT");
    return orden;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally { client.release(); }
}

async function insertItems(
  client: import("pg").PoolClient, tI: string, empresaId: string, ordenId: string, items: OrdenItemInput[]
): Promise<void> {
  for (const [i, it] of items.entries()) {
    await client.query(
      `INSERT INTO ${tI} (empresa_id, orden_id, producto_id, producto_nombre, descripcion, cantidad,
         costo_unitario_estimado, iva_tipo, cuenta_contable_id, orden_linea)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::numeric,$7::numeric,$8,$9::uuid,$10)`,
      [empresaId, ordenId, it.producto_id, it.producto_nombre, it.descripcion, it.cantidad,
       it.costo_unitario_estimado, it.iva_tipo, it.cuenta_contable_id, i + 1]
    );
  }
}

/** Edita la orden. Solo permitido si NO tiene recepciones confirmadas y no está cerrada/cancelada. */
export async function updateOrden(
  schemaRaw: string, empresaId: string, ordenId: string,
  d: Omit<OrdenInput, "idempotency_key" | "created_by" | "usuario_nombre">
): Promise<OrdenRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  validarItems(d.items);
  const tO = quoteSchemaTable(schema, "ordenes_compra");
  const tI = quoteSchemaTable(schema, "orden_compra_items");
  const tR = quoteSchemaTable(schema, "recepciones");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: cur } = await client.query<{ estado: string }>(
      `SELECT estado FROM ${tO} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [ordenId, empresaId]
    );
    if (!cur[0]) throw new OrdenError("Orden no encontrada.", 404);
    if (["cerrada", "cancelada"].includes(cur[0].estado)) {
      throw new OrdenError("No se puede editar una orden cerrada o cancelada.", 409);
    }
    const { rows: rc } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${tR} WHERE orden_id=$1::uuid AND empresa_id=$2::uuid AND estado='confirmada'`,
      [ordenId, empresaId]
    );
    if (Number(rc[0]?.n ?? 0) > 0) {
      throw new OrdenError("La orden ya tiene recepciones registradas; no se puede editar.", 409);
    }
    const { rows } = await client.query(
      `UPDATE ${tO} SET proveedor_id=$3::uuid, proveedor_nombre=$4, fecha=$5::date, fecha_estimada=$6::date,
         observaciones=$7, moneda=$8, tipo_cambio=$9::numeric, total_estimado=$10::numeric, updated_at=now()
       WHERE id=$1::uuid AND empresa_id=$2::uuid
       RETURNING ${OC_COLS.replace(/o\./g, "")}`,
      [ordenId, empresaId, d.proveedor_id, d.proveedor_nombre, d.fecha, d.fecha_estimada || null,
       d.observaciones, d.moneda, d.tipo_cambio, totalEstimado(d.items)]
    );
    await client.query(`DELETE FROM ${tI} WHERE orden_id=$1::uuid AND empresa_id=$2::uuid`, [ordenId, empresaId]);
    await insertItems(client, tI, empresaId, ordenId, d.items);
    await client.query("COMMIT");
    return rows[0] as OrdenRow;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally { client.release(); }
}

/** Aprobar / cancelar / cerrar manualmente, con motivo y auditoría. */
export async function cambiarEstadoOrden(
  schemaRaw: string, empresaId: string, ordenId: string,
  accion: "aprobar" | "cancelar" | "cerrar", motivo: string | null, userId: string | null
): Promise<OrdenRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tO = quoteSchemaTable(schema, "ordenes_compra");
  const tR = quoteSchemaTable(schema, "recepciones");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: cur } = await client.query<{ estado: string }>(
      `SELECT estado FROM ${tO} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`, [ordenId, empresaId]
    );
    if (!cur[0]) throw new OrdenError("Orden no encontrada.", 404);
    const estado = cur[0].estado;

    let sql: string; let params: unknown[];
    if (accion === "aprobar") {
      if (estado !== "borrador") throw new OrdenError("Solo se puede aprobar una orden en borrador.", 409);
      sql = `UPDATE ${tO} SET estado='aprobada', aprobada_by=$3::uuid, aprobada_at=now(), updated_at=now()
             WHERE id=$1::uuid AND empresa_id=$2::uuid RETURNING ${OC_COLS.replace(/o\./g, "")}`;
      params = [ordenId, empresaId, userId];
    } else if (accion === "cancelar") {
      if (["cerrada", "cancelada"].includes(estado)) throw new OrdenError("La orden ya está cerrada o cancelada.", 409);
      const { rows: rc } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${tR} WHERE orden_id=$1::uuid AND empresa_id=$2::uuid AND estado='confirmada'`,
        [ordenId, empresaId]
      );
      if (Number(rc[0]?.n ?? 0) > 0) throw new OrdenError("No se puede cancelar: la orden ya tiene recepciones. Usá el cierre manual.", 409);
      if (!motivo?.trim()) throw new OrdenError("Indicá el motivo de la cancelación.");
      sql = `UPDATE ${tO} SET estado='cancelada', cancelada_by=$3::uuid, cancelada_at=now(),
               motivo_cancelacion=$4, updated_at=now()
             WHERE id=$1::uuid AND empresa_id=$2::uuid RETURNING ${OC_COLS.replace(/o\./g, "")}`;
      params = [ordenId, empresaId, userId, motivo.trim()];
    } else {
      if (["cerrada", "cancelada"].includes(estado)) throw new OrdenError("La orden ya está cerrada o cancelada.", 409);
      if (!motivo?.trim()) throw new OrdenError("Indicá el motivo del cierre manual.");
      sql = `UPDATE ${tO} SET estado='cerrada', cerrada_by=$3::uuid, cerrada_at=now(),
               motivo_cierre=$4, cierre_automatico=false, updated_at=now()
             WHERE id=$1::uuid AND empresa_id=$2::uuid RETURNING ${OC_COLS.replace(/o\./g, "")}`;
      params = [ordenId, empresaId, userId, motivo.trim()];
    }
    const { rows } = await client.query(sql, params);
    await client.query("COMMIT");
    return rows[0] as OrdenRow;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally { client.release(); }
}

/**
 * Recalcula el estado de la orden dentro de la transacción del documento que la
 * movió (recepción o compra). Nunca pisa un cierre/cancelación manual.
 *   todo recibido + todo facturado → 'cerrada' (automático)
 *   algo recibido                  → 'parcialmente_recibida' / 'recibida'
 */
export async function recalcularEstadoOrdenEnTx(
  client: import("pg").PoolClient, schema: string, empresaId: string, ordenId: string
): Promise<void> {
  const tO = quoteSchemaTable(schema, "ordenes_compra");
  const tOCI = quoteSchemaTable(schema, "orden_compra_items");
  const tR = quoteSchemaTable(schema, "recepciones");
  const tRI = quoteSchemaTable(schema, "recepcion_items");

  const { rows: est } = await client.query<{ estado: string }>(
    `SELECT estado FROM ${tO} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`, [ordenId, empresaId]
  );
  if (!est[0] || ["cerrada", "cancelada"].includes(est[0].estado)) return;

  const { rows } = await client.query<{ solicitada: string; recibida: string; facturada: string }>(
    `SELECT COALESCE(SUM(i.cantidad),0)::text AS solicitada,
            COALESCE(SUM(rec.recibida),0)::text AS recibida,
            COALESCE(SUM(rec.facturada),0)::text AS facturada
       FROM ${tOCI} i
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(ri.cantidad_recibida),0) AS recibida,
                COALESCE(SUM(ri.cantidad_facturada),0) AS facturada
           FROM ${tRI} ri JOIN ${tR} r ON r.id=ri.recepcion_id AND r.estado='confirmada'
          WHERE ri.orden_item_id = i.id
       ) rec ON true
      WHERE i.orden_id=$1::uuid AND i.empresa_id=$2::uuid`,
    [ordenId, empresaId]
  );
  const sol = Number(rows[0]?.solicitada ?? 0);
  const rec = Number(rows[0]?.recibida ?? 0);
  const fac = Number(rows[0]?.facturada ?? 0);

  if (sol > 0 && rec >= sol && fac >= rec) {
    await client.query(
      `UPDATE ${tO} SET estado='cerrada', cerrada_at=now(), cierre_automatico=true,
         motivo_cierre=COALESCE(motivo_cierre,'Cierre automático: todo recibido y facturado'), updated_at=now()
       WHERE id=$1::uuid AND empresa_id=$2::uuid`, [ordenId, empresaId]);
    return;
  }
  const nuevo = rec <= 0 ? "aprobada" : rec >= sol ? "recibida" : "parcialmente_recibida";
  await client.query(
    `UPDATE ${tO} SET estado=$3, updated_at=now() WHERE id=$1::uuid AND empresa_id=$2::uuid`,
    [ordenId, empresaId, nuevo]
  );
}
