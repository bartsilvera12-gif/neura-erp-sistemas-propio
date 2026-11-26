/**
 * Órdenes de compra con la forma del ERP 2.0 sobre `neura.ordenes_compra` / `orden_compra_items`.
 *
 * Estados: el 2.0 no tiene aprobación, así que una orden nueva se crea y se aprueba en el mismo
 * paso. Equivalencias: borrador/aprobada → pendiente · parcialmente_recibida → recibida_parcial ·
 * recibida/cerrada → recibida_total · cancelada → cancelada.
 *
 * Lo recibido de cada línea = recepciones de Neura + compras hechas desde la orden (pantalla
 * "Recibir" del 2.0, que es una compra con `orden_compra_id`).
 * La condición de pago no tiene columna en Neura: va en las observaciones.
 */
import type { Pool } from "pg";
import { cambiarEstadoOrden, createOrden, updateOrden, type IvaTipo } from "@/lib/ordenes/server/ordenes-pg";
import { ErrorV2, esUuid } from "./server";

const ESTADO_A_20: Record<string, string> = {
  solicitada: "solicitada",
  borrador: "pendiente",
  aprobada: "pendiente",
  parcialmente_recibida: "recibida_parcial",
  recibida: "recibida_total",
  cerrada: "recibida_total",
  cancelada: "cancelada",
  rechazada: "rechazada",
};
const ESTADOS_DE: Record<string, string[]> = {
  solicitada: ["solicitada"],
  pendiente: ["borrador", "aprobada"],
  recibida_parcial: ["parcialmente_recibida"],
  recibida_total: ["recibida", "cerrada"],
  cancelada: ["cancelada"],
  rechazada: ["rechazada"],
};
const IVA_20: Record<string, string> = { "10": "10%", "5": "5%", exenta: "exenta" };

/** Cantidad recibida por línea de orden (recepciones + compras directas desde la orden). */
const SQL_RECIBIDA = `(
  COALESCE((SELECT SUM(ri.cantidad_recibida) FROM neura.recepcion_items ri JOIN neura.recepciones r ON r.id = ri.recepcion_id
             WHERE ri.orden_item_id = i.id AND r.estado = 'confirmada'), 0)
  + COALESCE((SELECT SUM(ci.cantidad) FROM neura.compra_items ci JOIN neura.compras c ON c.id = ci.compra_id
              WHERE c.orden_compra_id = i.orden_id AND ci.producto_id = i.producto_id AND ci.recepcion_item_id IS NULL
                AND COALESCE(c.estado, '') <> 'anulada'), 0))`;

/** Condición de pago guardada al principio de las observaciones. */
const RE_COND = /^\[(contado|crédito(?: (\d+) días)?)\]\s*/i;
function leerCondicion(obs: string | null) {
  const m = (obs ?? "").match(RE_COND);
  if (!m) return { tipo_pago: "contado" as const, plazo_dias: null, observacion: obs };
  return {
    tipo_pago: m[1].toLowerCase().startsWith("cr") ? ("credito" as const) : ("contado" as const),
    plazo_dias: m[2] ? Number(m[2]) : null,
    observacion: (obs ?? "").replace(RE_COND, "") || null,
  };
}
function escribirCondicion(b: Record<string, unknown>) {
  const credito = b.tipo_pago === "credito";
  const plazo = Number(b.plazo_dias) || 0;
  const cond = credito ? `[crédito${plazo ? ` ${plazo} días` : ""}]` : "[contado]";
  const obs = typeof b.observacion === "string" ? b.observacion.trim() : "";
  return `${cond}${obs ? ` ${obs}` : ""}`.slice(0, 2000);
}

function fila(o: Record<string, unknown>) {
  const cond = leerCondicion((o.observaciones as string | null) ?? null);
  return {
    id: o.id,
    numero_oc: o.numero,
    proveedor_id: o.proveedor_id,
    proveedor_nombre: o.proveedor_nombre,
    fecha: o.fecha,
    fecha_entrega: o.fecha_estimada,
    tipo_pago: cond.tipo_pago,
    plazo_dias: cond.plazo_dias,
    moneda: o.moneda === "USD" ? "USD" : "GS",
    tipo_cambio: Number(o.tipo_cambio) || 1,
    total: Number(o.total_estimado) || 0,
    estado: ESTADO_A_20[String(o.estado)] ?? "pendiente",
    observacion: cond.observacion,
    usuario_nombre: o.usuario_nombre,
    cancelada_at: o.cancelada_at,
    cancelada_por: null,
    cancelada_motivo: o.motivo_cancelacion,
  };
}

export async function listarOrdenes(pool: Pool, empresaId: string, sp: URLSearchParams) {
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const where = ["o.empresa_id = $1::uuid"];
  const args: unknown[] = [empresaId];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  const estado = sp.get("estado") ?? "";
  if (ESTADOS_DE[estado]) where.push(`o.estado = ANY(${arg(ESTADOS_DE[estado])}::text[])`);
  const prov = sp.get("proveedor") ?? "";
  if (esUuid(prov)) where.push(`o.proveedor_id = ${arg(prov)}::uuid`);
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    const a = arg(`%${q}%`);
    where.push(`(o.numero ILIKE ${a} OR COALESCE(o.proveedor_nombre, '') ILIKE ${a}
                 OR EXISTS (SELECT 1 FROM neura.orden_compra_items i WHERE i.orden_id = o.id AND i.producto_nombre ILIKE ${a}))`);
  }
  const w = where.join(" AND ");
  const n = args.length;
  const lim = arg(porPagina);
  const off = arg((pagina - 1) * porPagina);
  const [{ rows }, { rows: tot }] = await Promise.all([
    pool.query(
      `SELECT o.*,
              (SELECT count(*) FROM neura.orden_compra_items i WHERE i.orden_id = o.id)::int AS cantidad_items,
              COALESCE((SELECT SUM(i.cantidad) FROM neura.orden_compra_items i WHERE i.orden_id = o.id), 0)::float AS unidades,
              COALESCE((SELECT SUM(LEAST(i.cantidad, ${SQL_RECIBIDA})) FROM neura.orden_compra_items i WHERE i.orden_id = o.id), 0)::float AS recibidas
         FROM neura.ordenes_compra o WHERE ${w}
        ORDER BY o.fecha DESC, o.numero DESC LIMIT ${lim} OFFSET ${off}`,
      args
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM neura.ordenes_compra o WHERE ${w}`, args.slice(0, n)),
  ]);
  return {
    rows: rows.map((o) => ({ ...fila(o), cantidad_items: o.cantidad_items, unidades: o.unidades, recibidas: o.recibidas })),
    total: tot[0]?.n ?? 0,
  };
}

export async function detalleOrden(pool: Pool, empresaId: string, id: string) {
  const { rows } = await pool.query(`SELECT * FROM neura.ordenes_compra WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
  if (!rows[0]) throw new ErrorV2("Orden de compra no encontrada", 404);
  const { rows: items } = await pool.query(
    `SELECT i.id, i.producto_id, i.producto_nombre, p.sku AS producto_sku, i.cantidad::float AS cantidad,
            ${SQL_RECIBIDA}::float AS cantidad_recibida, i.costo_unitario_estimado::float AS costo, i.iva_tipo
       FROM neura.orden_compra_items i LEFT JOIN neura.productos p ON p.id = i.producto_id
      WHERE i.orden_id = $1::uuid ORDER BY i.orden_linea NULLS LAST, i.created_at`,
    [id]
  );
  const { rows: compras } = await pool.query(
    `SELECT id, numero_control, COALESCE(numero_comprobante, '') AS numero_factura, fecha, total::float AS total, estado
       FROM neura.compras WHERE orden_compra_id = $1::uuid AND empresa_id = $2::uuid ORDER BY fecha`,
    [id, empresaId]
  );
  return {
    ...fila(rows[0]),
    items: items.map((i) => ({
      id: i.id,
      producto_id: i.producto_id,
      producto_nombre: i.producto_nombre,
      producto_sku: i.producto_sku,
      cantidad: i.cantidad,
      cantidad_recibida: Math.min(i.cantidad, i.cantidad_recibida),
      costo_unitario_original: i.costo,
      costo_unitario: i.costo,
      tipo_iva: IVA_20[i.iva_tipo] ?? "10%",
      total: Math.round(i.cantidad * i.costo),
    })),
    compras,
  };
}

async function lineas(pool: Pool, empresaId: string, b: Record<string, unknown>) {
  const items = (Array.isArray(b.items) ? b.items : []) as { producto_id?: string; cantidad?: number; costo_unitario?: number }[];
  if (!items.length) throw new ErrorV2("La orden no tiene productos");
  const ids = items.map((i) => i.producto_id).filter(esUuid);
  const { rows } = await pool.query(`SELECT id, nombre FROM neura.productos WHERE id = ANY($1::uuid[]) AND empresa_id = $2::uuid`, [ids, empresaId]);
  const nombre = new Map(rows.map((r) => [r.id, r.nombre]));
  return items.map((i, k) => {
    if (!esUuid(i.producto_id) || !nombre.has(i.producto_id)) throw new ErrorV2(`Línea ${k + 1}: producto no encontrado`);
    const cantidad = Number(i.cantidad);
    if (!(cantidad > 0)) throw new ErrorV2(`"${nombre.get(i.producto_id)}": la cantidad tiene que ser mayor a 0`);
    const costo = Number(i.costo_unitario) || 0;
    return {
      producto_id: i.producto_id as string,
      producto_nombre: nombre.get(i.producto_id) as string,
      descripcion: null,
      cantidad,
      // validarItems de Neura pide costo > 0: una orden sin precio lleva 1 Gs. simbólico.
      costo_unitario_estimado: costo > 0 ? costo : 1,
      iva_tipo: "10" as IvaTipo,
      cuenta_contable_id: null,
    };
  });
}

async function proveedor(pool: Pool, empresaId: string, id: unknown) {
  if (!esUuid(id)) throw new ErrorV2("Elegí el proveedor");
  const { rows } = await pool.query(`SELECT id, nombre FROM neura.proveedores WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
  if (!rows[0]) throw new ErrorV2("Proveedor no encontrado");
  return rows[0] as { id: string; nombre: string };
}

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });

export async function crearOrden(pool: Pool, q: { empresaId: string; usuarioId: string; nombre: string }, b: Record<string, unknown>) {
  const pr = await proveedor(pool, q.empresaId, b.proveedor_id);
  const usd = b.moneda === "USD";
  const o = await createOrden("neura", q.empresaId, {
    proveedor_id: pr.id,
    proveedor_nombre: pr.nombre,
    fecha: hoy(),
    fecha_estimada: typeof b.fecha_entrega === "string" && b.fecha_entrega ? b.fecha_entrega : null,
    observaciones: escribirCondicion(b),
    moneda: usd ? "USD" : "PYG",
    tipo_cambio: usd ? Number(b.tipo_cambio) || 1 : 1,
    items: await lineas(pool, q.empresaId, b),
    idempotency_key: esUuid(b.idempotency_key) ? (b.idempotency_key as string) : null,
    created_by: q.usuarioId,
    usuario_nombre: q.nombre,
  });
  // El 2.0 no tiene aprobación: la orden queda lista para recibir.
  if (o.estado === "borrador") await cambiarEstadoOrden("neura", q.empresaId, o.id, "aprobar", null, q.usuarioId);
  return { id: o.id, numero_oc: o.numero };
}

/**
 * Solicitud de compra (comercial). Igual que crearOrden pero queda 'solicitada':
 * NO se auto-aprueba — espera la confirmación (Fase 2) y el pago (Fase 3) antes
 * de poder recibirse. Las líneas ya exigen producto real del inventario.
 */
export async function crearSolicitud(pool: Pool, q: { empresaId: string; usuarioId: string; nombre: string }, b: Record<string, unknown>) {
  const pr = await proveedor(pool, q.empresaId, b.proveedor_id);
  const usd = b.moneda === "USD";
  const o = await createOrden("neura", q.empresaId, {
    proveedor_id: pr.id,
    proveedor_nombre: pr.nombre,
    fecha: hoy(),
    fecha_estimada: typeof b.fecha_entrega === "string" && b.fecha_entrega ? b.fecha_entrega : null,
    observaciones: escribirCondicion(b),
    moneda: usd ? "USD" : "PYG",
    tipo_cambio: usd ? Number(b.tipo_cambio) || 1 : 1,
    items: await lineas(pool, q.empresaId, b),
    idempotency_key: esUuid(b.idempotency_key) ? (b.idempotency_key as string) : null,
    created_by: q.usuarioId,
    usuario_nombre: q.nombre,
    estado: "solicitada",
    solicitada_by: q.usuarioId,
  });
  return { id: o.id, numero_oc: o.numero };
}

export async function editarOrden(pool: Pool, empresaId: string, id: string, b: Record<string, unknown>) {
  const pr = await proveedor(pool, empresaId, b.proveedor_id);
  const { rows } = await pool.query(`SELECT fecha FROM neura.ordenes_compra WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
  if (!rows[0]) throw new ErrorV2("Orden de compra no encontrada", 404);
  const { rows: rec } = await pool.query(`SELECT 1 FROM neura.compras WHERE orden_compra_id = $1::uuid AND COALESCE(estado, '') <> 'anulada' LIMIT 1`, [id]);
  if (rec.length) throw new ErrorV2("La orden ya tiene mercadería recibida: no se puede editar.");
  const usd = b.moneda === "USD";
  const o = await updateOrden("neura", empresaId, id, {
    proveedor_id: pr.id,
    proveedor_nombre: pr.nombre,
    fecha: new Date(rows[0].fecha).toISOString().slice(0, 10),
    fecha_estimada: typeof b.fecha_entrega === "string" && b.fecha_entrega ? b.fecha_entrega : null,
    observaciones: escribirCondicion(b),
    moneda: usd ? "USD" : "PYG",
    tipo_cambio: usd ? Number(b.tipo_cambio) || 1 : 1,
    items: await lineas(pool, empresaId, b),
  });
  return { id: o.id, numero_oc: o.numero };
}

export async function cancelarOrden(pool: Pool, q: { empresaId: string; usuarioId: string }, id: string, motivo: string) {
  const { rows: rec } = await pool.query(`SELECT 1 FROM neura.compras WHERE orden_compra_id = $1::uuid AND COALESCE(estado, '') <> 'anulada' LIMIT 1`, [id]);
  if (rec.length) throw new ErrorV2("No se puede cancelar: la orden ya tiene mercadería recibida.");
  const o = await cambiarEstadoOrden("neura", q.empresaId, id, "cancelar", motivo, q.usuarioId);
  return { id: o.id, estado: "cancelada" };
}

/** Después de recibir (o anular lo recibido) con una compra: recalcula el estado de la orden. */
export async function actualizarEstadoOrden(pool: Pool, empresaId: string, ordenId: string) {
  const { rows } = await pool.query(
    `SELECT o.estado, COALESCE(SUM(i.cantidad), 0)::float AS pedida, COALESCE(SUM(LEAST(i.cantidad, ${SQL_RECIBIDA})), 0)::float AS recibida
       FROM neura.ordenes_compra o LEFT JOIN neura.orden_compra_items i ON i.orden_id = o.id
      WHERE o.id = $1::uuid AND o.empresa_id = $2::uuid GROUP BY o.estado`,
    [ordenId, empresaId]
  );
  const r = rows[0];
  if (!r || ["cerrada", "cancelada"].includes(r.estado)) return;
  // Si se anuló lo recibido, vuelve a quedar pendiente (aprobada).
  const nuevo = r.recibida <= 0 ? (["parcialmente_recibida", "recibida"].includes(r.estado) ? "aprobada" : r.estado)
    : r.recibida >= r.pedida ? "recibida" : "parcialmente_recibida";
  if (nuevo !== r.estado) await pool.query(`UPDATE neura.ordenes_compra SET estado = $2, updated_at = now() WHERE id = $1::uuid`, [ordenId, nuevo]);
}
