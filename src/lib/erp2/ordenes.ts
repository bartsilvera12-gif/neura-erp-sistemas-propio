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
import { enTransaccion, ErrorV2, esUuid } from "./server";

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
const RE_COND = /^\[(contado|crédito(?: (\d+) días)?(?: · (\d+) cuotas?)?)\]\s*/i;
function leerCondicion(obs: string | null) {
  const m = (obs ?? "").match(RE_COND);
  if (!m) return { tipo_pago: "contado" as const, plazo_dias: null, cuotas: null, observacion: obs };
  return {
    tipo_pago: m[1].toLowerCase().startsWith("cr") ? ("credito" as const) : ("contado" as const),
    plazo_dias: m[2] ? Number(m[2]) : null,
    cuotas: m[3] ? Number(m[3]) : null,
    observacion: (obs ?? "").replace(RE_COND, "") || null,
  };
}
function escribirCondicion(b: Record<string, unknown>) {
  const credito = b.tipo_pago === "credito";
  const plazo = Number(b.plazo_dias) || 0;
  const cuotas = Number(b.cuotas) || 0;
  const cond = credito ? `[crédito${plazo ? ` ${plazo} días` : ""}${cuotas > 0 ? ` · ${cuotas} cuotas` : ""}]` : "[contado]";
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
    cuotas: cond.cuotas,
    moneda: o.moneda === "USD" ? "USD" : "GS",
    tipo_cambio: Number(o.tipo_cambio) || 1,
    total: Number(o.total_estimado) || 0,
    estado: ESTADO_A_20[String(o.estado)] ?? "pendiente",
    pago_estado: o.pago_estado === "confirmado" ? "confirmado" : "pendiente",
    pago_metodo: (o.pago_metodo as string | null) ?? null,
    pago_referencia: (o.pago_referencia as string | null) ?? null,
    pago_confirmado_at: (o.pago_confirmado_at as string | null) ?? null,
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

/**
 * Fase 2 — Alan confirma una solicitud. Puede ajustar cantidades/costos o quitar
 * líneas (lo que no se consigue) antes de aprobar. La solicitud pasa a 'aprobada'
 * (queda firme, lista para que Guillermo confirme el pago y luego se reciba).
 * Solo opera sobre una solicitud en estado 'solicitada'; todo en una transacción.
 */
export async function confirmarSolicitud(
  pool: Pool,
  q: { empresaId: string; usuarioId: string },
  id: string,
  b: Record<string, unknown>
) {
  // Si vienen líneas editadas, se revalidan (producto real + cantidad > 0) antes de tocar nada.
  const items = Array.isArray(b.items) && (b.items as unknown[]).length ? await lineas(pool, q.empresaId, b) : null;
  return enTransaccion(pool, async (c) => {
    const { rows } = await c.query<{ estado: string }>(
      `SELECT estado FROM neura.ordenes_compra WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [id, q.empresaId]
    );
    if (!rows[0]) throw new ErrorV2("Solicitud no encontrada", 404);
    if (rows[0].estado !== "solicitada") throw new ErrorV2("Esta solicitud ya fue confirmada o rechazada.", 409);
    if (items) {
      await c.query(`DELETE FROM neura.orden_compra_items WHERE orden_id = $1::uuid AND empresa_id = $2::uuid`, [id, q.empresaId]);
      for (const [k, it] of items.entries()) {
        await c.query(
          `INSERT INTO neura.orden_compra_items (empresa_id, orden_id, producto_id, producto_nombre, descripcion, cantidad,
             costo_unitario_estimado, iva_tipo, cuenta_contable_id, orden_linea)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::numeric,$7::numeric,$8,$9::uuid,$10)`,
          [q.empresaId, id, it.producto_id, it.producto_nombre, it.descripcion, it.cantidad,
           it.costo_unitario_estimado, it.iva_tipo, it.cuenta_contable_id, k + 1]
        );
      }
      const total = items.reduce((s, it) => s + it.cantidad * it.costo_unitario_estimado, 0);
      await c.query(
        `UPDATE neura.ordenes_compra SET total_estimado = $3::numeric WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [id, q.empresaId, total]
      );
    }
    await c.query(
      `UPDATE neura.ordenes_compra SET estado = 'aprobada', aprobada_by = $3::uuid, aprobada_at = now(), updated_at = now()
        WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, q.empresaId, q.usuarioId]
    );
    return { id, estado: "aprobada" as const };
  });
}

/** Fase 2 — Alan rechaza una solicitud (con motivo). Pasa a 'rechazada'. */
export async function rechazarSolicitud(
  pool: Pool,
  q: { empresaId: string; usuarioId: string },
  id: string,
  motivo: string
) {
  const m = (motivo ?? "").trim();
  if (!m) throw new ErrorV2("Indicá el motivo del rechazo.");
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE neura.ordenes_compra
        SET estado = 'rechazada', rechazada_by = $3::uuid, rechazada_at = now(), motivo_rechazo = $4, updated_at = now()
      WHERE id = $1::uuid AND empresa_id = $2::uuid AND estado = 'solicitada'
      RETURNING id`,
    [id, q.empresaId, q.usuarioId, m.slice(0, 500)]
  );
  if (!rows[0]) throw new ErrorV2("Esta solicitud ya fue confirmada o rechazada.", 409);
  return { id, estado: "rechazada" as const };
}

/**
 * Fase 3 — Bandeja de pagos (Guillermo). Órdenes ya firmes (aprobadas en
 * adelante, sin cancelar/rechazar) con su estado de pago. Por defecto las que
 * están 'pendiente'; `pago=confirmado` muestra las ya pagadas y `pago=''` todas.
 */
export async function listarPorPagar(pool: Pool, empresaId: string, sp: URLSearchParams) {
  const args: unknown[] = [empresaId];
  const where = ["o.empresa_id = $1::uuid", "o.estado = ANY(ARRAY['aprobada','parcialmente_recibida','recibida','cerrada']::text[])"];
  const pago = sp.get("pago");
  if (pago === "pendiente" || pago === "confirmado") {
    args.push(pago);
    where.push(`COALESCE(o.pago_estado, 'pendiente') = $${args.length}`);
  } else if (pago == null) {
    where.push(`COALESCE(o.pago_estado, 'pendiente') = 'pendiente'`);
  }
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    args.push(`%${q}%`);
    const a = `$${args.length}`;
    where.push(`(o.numero ILIKE ${a} OR COALESCE(o.proveedor_nombre, '') ILIKE ${a})`);
  }
  const { rows } = await pool.query(
    `SELECT o.*,
            (SELECT count(*) FROM neura.orden_compra_items i WHERE i.orden_id = o.id)::int AS cantidad_items,
            COALESCE((SELECT SUM(i.cantidad) FROM neura.orden_compra_items i WHERE i.orden_id = o.id), 0)::float AS unidades
       FROM neura.ordenes_compra o WHERE ${where.join(" AND ")}
      ORDER BY o.fecha DESC, o.numero DESC LIMIT 200`,
    args
  );
  return { rows: rows.map((o) => ({ ...fila(o), cantidad_items: o.cantidad_items, unidades: o.unidades })) };
}

/**
 * Fase 5.3 — "Mi bandeja de compras": cada persona ve las secciones que le tocan.
 * Mis solicitudes (las que creé, siempre) + Por confirmar / Por pagar / Por recibir
 * según los roles (resueltos por el llamador con fallback a admins).
 */
export async function miBandejaCompra(
  pool: Pool,
  q: { empresaId: string; usuarioId: string },
  roles: { confirma: boolean; paga: boolean; recibe: boolean }
) {
  const seccion = async (where: string, args: unknown[]) => {
    const [{ rows }, { rows: tot }] = await Promise.all([
      pool.query(
        `SELECT o.*, (SELECT count(*) FROM neura.orden_compra_items i WHERE i.orden_id = o.id)::int AS cantidad_items
           FROM neura.ordenes_compra o WHERE ${where} ORDER BY o.fecha DESC, o.numero DESC LIMIT 6`,
        args
      ),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM neura.ordenes_compra o WHERE ${where}`, args),
    ]);
    return { total: tot[0]?.n ?? 0, rows: rows.map((o) => ({ ...fila(o), cantidad_items: o.cantidad_items })) };
  };
  const firme = "o.estado = ANY(ARRAY['aprobada','parcialmente_recibida','recibida','cerrada']::text[])";
  const out: Record<string, { total: number; rows: unknown[] }> = {};
  out.mis_solicitudes = await seccion("o.empresa_id = $1::uuid AND o.solicitada_by = $2::uuid", [q.empresaId, q.usuarioId]);
  if (roles.confirma) out.por_confirmar = await seccion("o.empresa_id = $1::uuid AND o.estado = 'solicitada'", [q.empresaId]);
  if (roles.paga) out.por_pagar = await seccion(`o.empresa_id = $1::uuid AND ${firme} AND COALESCE(o.pago_estado, 'pendiente') = 'pendiente'`, [q.empresaId]);
  if (roles.recibe) out.por_recibir = await seccion("o.empresa_id = $1::uuid AND o.estado = ANY(ARRAY['aprobada','parcialmente_recibida']::text[])", [q.empresaId]);
  return out;
}

/**
 * Fase 3 — Guillermo confirma el pago de una orden aprobada. Versión simple:
 * marca `pago_estado='confirmado'` con método/referencia opcionales. (El registro
 * contable — Compra + cuota — queda para una fase posterior, según el plan.)
 * Solo sobre órdenes firmes con pago pendiente.
 */
export async function confirmarPago(
  pool: Pool,
  q: { empresaId: string; usuarioId: string },
  id: string,
  b: Record<string, unknown>
) {
  const metodo = typeof b.metodo === "string" ? b.metodo.trim().slice(0, 60) || null : null;
  const referencia = typeof b.referencia === "string" ? b.referencia.trim().slice(0, 120) || null : null;
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE neura.ordenes_compra
        SET pago_estado = 'confirmado', pago_confirmado_by = $3::uuid, pago_confirmado_at = now(),
            pago_metodo = $4, pago_referencia = $5, updated_at = now()
      WHERE id = $1::uuid AND empresa_id = $2::uuid
        AND estado = ANY(ARRAY['aprobada','parcialmente_recibida','recibida','cerrada']::text[])
        AND COALESCE(pago_estado, 'pendiente') = 'pendiente'
      RETURNING id`,
    [id, q.empresaId, q.usuarioId, metodo, referencia]
  );
  if (!rows[0]) throw new ErrorV2("Esta orden no está lista para pagar o ya tiene el pago confirmado.", 409);
  return { id, pago_estado: "confirmado" as const };
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
