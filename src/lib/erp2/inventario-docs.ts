/**
 * Movimientos, ajustes y traslados con la forma del ERP 2.0, sobre las tablas de Neura
 * (`movimientos_inventario`, `inventario_ajustes*`, `inventario_traslados*`). Las escrituras van
 * por las funciones `neura.inv_*`.
 */
import type { Pool } from "pg";
import { ErrorV2, esUuid } from "./server";

const fecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

// ─── Movimientos (kardex) ─────────────────────────────────────────────────

export async function listarMovimientos(pool: Pool, empresaId: string, sp: URLSearchParams) {
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const where = ["m.empresa_id = $1::uuid"];
  const args: unknown[] = [empresaId];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  const tipo = sp.get("tipo") ?? "";
  if (tipo === "ENTRADA" || tipo === "SALIDA") where.push(`m.tipo = ${arg(tipo)}`);
  const origenes = (sp.get("origen") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[a-z_]+$/.test(x));
  if (origenes.length) where.push(`m.origen = ANY(${arg(origenes)}::text[])`);
  const producto = sp.get("producto") ?? "";
  if (esUuid(producto)) where.push(`m.producto_id = ${arg(producto)}::uuid`);
  const deposito = sp.get("deposito") ?? "";
  if (esUuid(deposito)) where.push(`m.ubicacion_id = ${arg(deposito)}::uuid`);
  const desde = fecha(sp.get("desde"));
  if (desde) where.push(`m.fecha >= (${arg(desde)}::date AT TIME ZONE 'America/Asuncion')`);
  const hasta = fecha(sp.get("hasta"));
  if (hasta) where.push(`m.fecha < ((${arg(hasta)}::date + 1) AT TIME ZONE 'America/Asuncion')`);
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  for (const w of q.split(/\s+/).filter(Boolean).slice(0, 6)) {
    const a = arg(`%${w}%`);
    where.push(`(m.producto_nombre ILIKE ${a} OR m.producto_sku ILIKE ${a} OR COALESCE(m.documento_numero, m.referencia, '') ILIKE ${a}
                 OR COALESCE(m.usuario_nombre, '') ILIKE ${a})`);
  }
  const w = where.join(" AND ");
  const { rows: tot } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM neura.movimientos_inventario m WHERE ${w}`, args);
  // Saldo después de cada movimiento: en el depósito elegido, o el total del producto.
  const saldo = esUuid(producto)
    ? esUuid(deposito)
      ? "m.saldo_deposito::float"
      : `(SUM(CASE WHEN m.tipo = 'SALIDA' THEN -m.cantidad ELSE m.cantidad END)
           OVER (PARTITION BY m.producto_id ORDER BY m.fecha, m.created_at ROWS UNBOUNDED PRECEDING))::float`
    : "NULL::float";
  const lim = arg(porPagina);
  const off = arg((pagina - 1) * porPagina);
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT m.id, m.producto_id, m.producto_nombre, m.producto_sku, m.tipo, m.cantidad::float AS cantidad,
              COALESCE(m.costo_unitario, 0)::float AS costo_unitario, m.origen, m.referencia,
              co.proveedor_nombre AS proveedor, co.numero_comprobante AS numero_factura,
              m.usuario_nombre, m.fecha, m.ubicacion_id AS deposito_id, u.nombre AS deposito_nombre,
              CASE WHEN u.id IS NULL THEN NULL ELSE 'Casa central' END AS sucursal_nombre,
              CASE WHEN m.documento_tipo LIKE 'ajuste%' THEN (SELECT tipo FROM neura.inventario_ajustes WHERE id = m.documento_id)
                   WHEN m.documento_tipo LIKE 'traslado%' THEN 'traslado'
                   WHEN m.origen IN ('compra', 'recepcion') THEN 'compra'
                   WHEN m.origen = 'venta' THEN 'venta' END AS documento_tipo,
              COALESCE(m.documento_id, CASE WHEN m.origen = 'compra' THEN co.id END) AS documento_id,
              COALESCE(m.documento_numero, m.referencia) AS documento_numero,
              m.ubicacion_contraparte_id AS deposito_contraparte_id, c.nombre AS contraparte_nombre,
              ${saldo} AS saldo, m.created_at
         FROM neura.movimientos_inventario m
         LEFT JOIN neura.inventario_ubicaciones u ON u.id = m.ubicacion_id
         LEFT JOIN neura.inventario_ubicaciones c ON c.id = m.ubicacion_contraparte_id
         LEFT JOIN neura.compras co ON m.origen = 'compra' AND co.empresa_id = m.empresa_id AND co.numero_control = m.referencia
        WHERE ${w}
     ) x
     ORDER BY x.fecha DESC, x.created_at DESC
     LIMIT ${lim} OFFSET ${off}`,
    args
  );
  let prod = null;
  if (esUuid(producto)) {
    const { rows: p } = await pool.query(
      `SELECT id, nombre, sku, COALESCE(stock_actual, 0)::float AS stock_actual, COALESCE(NULLIF(unidad_medida, ''), 'Unidad') AS unidad_medida
         FROM neura.productos WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [producto, empresaId]
    );
    prod = p[0] ?? null;
    if (prod && esUuid(deposito)) {
      const { rows: s } = await pool.query(
        `SELECT COALESCE(stock_actual, 0)::float AS n FROM neura.inventario_stock_ubicacion WHERE producto_id = $1::uuid AND ubicacion_id = $2::uuid`,
        [producto, deposito]
      );
      prod = { ...prod, stock_deposito: s[0]?.n ?? 0 };
    }
  }
  return { rows, total: tot[0]?.n ?? 0, producto: prod };
}

// ─── Ajustes y pérdidas ───────────────────────────────────────────────────

const FILA_AJUSTE = `a.id, a.tipo, a.numero, a.estado, a.motivo, a.detalle,
  json_build_object('id', u.id, 'nombre', u.nombre, 'sucursal', 'Casa central') AS deposito,
  (SELECT count(*) FROM neura.inventario_ajustes_items i WHERE i.ajuste_id = a.id)::int AS items,
  COALESCE((SELECT SUM(diferencia) FROM neura.inventario_ajustes_items i WHERE i.ajuste_id = a.id AND diferencia > 0), 0)::float AS total_entrada,
  COALESCE((SELECT -SUM(diferencia) FROM neura.inventario_ajustes_items i WHERE i.ajuste_id = a.id AND diferencia < 0), 0)::float AS total_salida,
  COALESCE((SELECT SUM(diferencia * costo_unitario) FROM neura.inventario_ajustes_items i WHERE i.ajuste_id = a.id AND diferencia > 0), 0)::float AS valor_entrada,
  COALESCE((SELECT -SUM(diferencia * costo_unitario) FROM neura.inventario_ajustes_items i WHERE i.ajuste_id = a.id AND diferencia < 0), 0)::float AS valor_salida,
  a.usuario_nombre, a.created_at, a.usuario_nombre AS aplicado_por_nombre, a.created_at AS aplicado_at`;

export async function listarAjustes(pool: Pool, empresaId: string, sp: URLSearchParams) {
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const where = ["a.empresa_id = $1::uuid"];
  const args: unknown[] = [empresaId];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  const tipo = sp.get("tipo") ?? "";
  if (tipo === "ajuste" || tipo === "perdida") where.push(`a.tipo = ${arg(tipo)}`);
  const estado = sp.get("estado") ?? "";
  // Neura no tiene ajustes pendientes de aprobación: esa pestaña queda vacía.
  if (estado === "pendiente" || estado === "rechazado") where.push("false");
  else if (estado === "aplicado" || estado === "anulado") where.push(`a.estado = ${arg(estado)}`);
  const dep = sp.get("deposito") ?? "";
  if (esUuid(dep)) where.push(`a.ubicacion_id = ${arg(dep)}::uuid`);
  const desde = fecha(sp.get("desde"));
  if (desde) where.push(`a.created_at >= (${arg(desde)}::date AT TIME ZONE 'America/Asuncion')`);
  const hasta = fecha(sp.get("hasta"));
  if (hasta) where.push(`a.created_at < ((${arg(hasta)}::date + 1) AT TIME ZONE 'America/Asuncion')`);
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  if (q) {
    const a = arg(`%${q}%`);
    where.push(`(a.numero ILIKE ${a} OR COALESCE(a.detalle, '') ILIKE ${a} OR EXISTS
      (SELECT 1 FROM neura.inventario_ajustes_items i WHERE i.ajuste_id = a.id AND (i.producto_nombre ILIKE ${a} OR COALESCE(i.producto_sku, '') ILIKE ${a})))`);
  }
  const w = where.join(" AND ");
  const lim = arg(porPagina);
  const off = arg((pagina - 1) * porPagina);
  const [{ rows }, { rows: tot }, { rows: kpi }] = await Promise.all([
    pool.query(
      `SELECT ${FILA_AJUSTE} FROM neura.inventario_ajustes a JOIN neura.inventario_ubicaciones u ON u.id = a.ubicacion_id
        WHERE ${w} ORDER BY a.created_at DESC LIMIT ${lim} OFFSET ${off}`,
      args
    ),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM neura.inventario_ajustes a WHERE ${w}`, args.slice(0, args.length - 2)),
    pool.query(
      `SELECT COALESCE(-SUM(i.diferencia * i.costo_unitario) FILTER (WHERE a.tipo = 'perdida'), 0)::float AS perdidas_valor,
              COALESCE(-SUM(i.diferencia) FILTER (WHERE a.tipo = 'perdida'), 0)::float AS perdidas_unidades,
              COALESCE(SUM(i.diferencia * i.costo_unitario) FILTER (WHERE a.tipo = 'ajuste' AND i.diferencia > 0), 0)::float AS ajustes_entrada_valor,
              COALESCE(-SUM(i.diferencia * i.costo_unitario) FILTER (WHERE a.tipo = 'ajuste' AND i.diferencia < 0), 0)::float AS ajustes_salida_valor
         FROM neura.inventario_ajustes a JOIN neura.inventario_ajustes_items i ON i.ajuste_id = a.id
        WHERE a.empresa_id = $1::uuid AND a.estado = 'aplicado'`,
      [empresaId]
    ),
  ]);
  return { rows, total: tot[0]?.n ?? 0, pendientes: 0, totales: kpi[0] };
}

export async function detalleAjuste(pool: Pool, empresaId: string, id: string, esAdmin: boolean) {
  const { rows } = await pool.query(
    `SELECT ${FILA_AJUSTE}, NULL::text AS rechazado_por_nombre, NULL::timestamptz AS rechazado_at, NULL::text AS rechazado_motivo,
            a.anulado_por_nombre, a.anulado_at, a.anulado_motivo
       FROM neura.inventario_ajustes a JOIN neura.inventario_ubicaciones u ON u.id = a.ubicacion_id
      WHERE a.id = $1::uuid AND a.empresa_id = $2::uuid`,
    [id, empresaId]
  );
  if (!rows[0]) throw new ErrorV2("Documento no encontrado", 404);
  const { rows: items } = await pool.query(
    `SELECT i.id, i.orden, i.producto_id, i.producto_nombre, i.producto_sku, p.unidad_medida, i.modo,
            i.cantidad_contada::float AS cantidad_contada, i.stock_anterior::float AS cantidad_sistema,
            i.diferencia::float AS diferencia, i.costo_unitario::float AS costo_unitario,
            (i.diferencia * i.costo_unitario)::float AS valor, NULL AS lote_id, NULL AS lote_actual,
            NULL AS lote_numero, NULL AS vencimiento, NULL AS lotes, i.nota
       FROM neura.inventario_ajustes_items i LEFT JOIN neura.productos p ON p.id = i.producto_id
      WHERE i.ajuste_id = $1::uuid ORDER BY i.orden`,
    [id]
  );
  return { ...rows[0], es_admin: esAdmin, items };
}

// ─── Traslados ────────────────────────────────────────────────────────────

const remision = (numero: string) => `001-001-${(numero.match(/\d+$/)?.[0] ?? "0").padStart(7, "0")}`;

const FILA_TRASLADO = `t.id, t.numero, t.estado, (t.created_at AT TIME ZONE 'America/Asuncion')::date::text AS fecha_inicio,
  t.created_at, 7 AS motivo_codigo,
  json_build_object('id', o.id, 'nombre', o.nombre, 'sucursal', 'Casa central') AS origen,
  json_build_object('id', d.id, 'nombre', d.nombre, 'sucursal', 'Casa central', 'sucursal_id', t.empresa_id) AS destino,
  (SELECT count(*) FROM neura.inventario_traslados_items i WHERE i.traslado_id = t.id)::int AS total_items,
  t.total_unidades::float AS total_unidades,
  COALESCE((SELECT SUM(cantidad * costo_unitario) FROM neura.inventario_traslados_items i WHERE i.traslado_id = t.id), 0)::float AS valor_costo,
  t.diferencia_unidades::float AS diferencia_unidades,
  COALESCE((SELECT SUM((cantidad - COALESCE(cantidad_recibida, cantidad)) * costo_unitario)
              FROM neura.inventario_traslados_items i WHERE i.traslado_id = t.id), 0)::float AS diferencia_valor,
  t.usuario_nombre, t.recibido_at, t.recibido_por_nombre, t.anulado_at`;

const JOIN_TRASLADO = `FROM neura.inventario_traslados t
  JOIN neura.inventario_ubicaciones o ON o.id = t.ubicacion_origen_id
  JOIN neura.inventario_ubicaciones d ON d.id = t.ubicacion_destino_id`;

export async function listarTraslados(pool: Pool, empresaId: string, sp: URLSearchParams) {
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const where = ["t.empresa_id = $1::uuid"];
  const args: unknown[] = [empresaId];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  const estado = sp.get("estado") ?? "";
  if (["en_transito", "recibido", "recibido_con_diferencias", "anulado"].includes(estado)) where.push(`t.estado = ${arg(estado)}`);
  const dep = sp.get("deposito") ?? "";
  if (esUuid(dep)) {
    const a = arg(dep);
    where.push(`(t.ubicacion_origen_id = ${a}::uuid OR t.ubicacion_destino_id = ${a}::uuid)`);
  }
  const desde = fecha(sp.get("desde"));
  if (desde) where.push(`t.created_at >= (${arg(desde)}::date AT TIME ZONE 'America/Asuncion')`);
  const hasta = fecha(sp.get("hasta"));
  if (hasta) where.push(`t.created_at < ((${arg(hasta)}::date + 1) AT TIME ZONE 'America/Asuncion')`);
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  if (q) {
    const a = arg(`%${q}%`);
    where.push(`(t.numero ILIKE ${a} OR EXISTS (SELECT 1 FROM neura.inventario_traslados_items i
                  WHERE i.traslado_id = t.id AND (i.producto_nombre ILIKE ${a} OR COALESCE(i.producto_sku, '') ILIKE ${a})))`);
  }
  const w = where.join(" AND ");
  const n = args.length;
  const lim = arg(porPagina);
  const off = arg((pagina - 1) * porPagina);
  const [{ rows }, { rows: tot }, { rows: tr }] = await Promise.all([
    pool.query(`SELECT ${FILA_TRASLADO} ${JOIN_TRASLADO} WHERE ${w} ORDER BY t.created_at DESC LIMIT ${lim} OFFSET ${off}`, args),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM neura.inventario_traslados t WHERE ${w}`, args.slice(0, n)),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM neura.inventario_traslados WHERE empresa_id = $1::uuid AND estado = 'en_transito'`, [empresaId]),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, remision_numero: remision(r.numero) })),
    total: tot[0]?.n ?? 0,
    en_transito: tr[0]?.n ?? 0,
  };
}

export async function detalleTraslado(pool: Pool, empresaId: string, id: string, empresaNombre: string | null) {
  const { rows } = await pool.query(
    `SELECT ${FILA_TRASLADO}, t.observacion, t.diferencia_motivo, t.anulado_por_nombre, t.anulado_motivo,
            json_build_object('id', o.id, 'nombre', o.nombre, 'sucursal_id', t.empresa_id, 'sucursal', 'Casa central',
                              'direccion', o.descripcion, 'ciudad', NULL, 'telefono', NULL,
                              'establecimiento', '001', 'punto_expedicion', '001') AS origen_completo,
            json_build_object('id', d.id, 'nombre', d.nombre, 'sucursal_id', t.empresa_id, 'sucursal', 'Casa central',
                              'direccion', d.descripcion, 'ciudad', NULL, 'telefono', NULL) AS destino_completo
       ${JOIN_TRASLADO} WHERE t.id = $1::uuid AND t.empresa_id = $2::uuid`,
    [id, empresaId]
  );
  const t = rows[0];
  if (!t) throw new ErrorV2("Traslado no encontrado", 404);
  const { rows: items } = await pool.query(
    `SELECT i.id, i.orden, i.producto_id, i.producto_nombre, i.producto_sku, p.unidad_medida, false AS controla_lotes,
            i.cantidad::float AS cantidad, i.cantidad_recibida::float AS cantidad_recibida,
            i.costo_unitario::float AS costo_unitario, '[]'::json AS lotes
       FROM neura.inventario_traslados_items i LEFT JOIN neura.productos p ON p.id = i.producto_id
      WHERE i.traslado_id = $1::uuid ORDER BY i.orden`,
    [id]
  );
  const { origen_completo, destino_completo, ...resto } = t;
  return {
    ...resto,
    remision_numero: remision(t.numero),
    motivo_descripcion: null,
    fecha_fin_estimada: null,
    punto_partida: origen_completo.nombre,
    ciudad_partida: null,
    punto_llegada: destino_completo.nombre,
    ciudad_llegada: null,
    vehiculo_marca: null,
    vehiculo_chapa: null,
    chofer_nombre: null,
    chofer_documento: null,
    transportista_nombre: null,
    transportista_ruc: null,
    recepcion_observacion: null,
    origen: origen_completo,
    destino: destino_completo,
    empresa: empresaNombre,
    puede_recibir: t.estado === "en_transito",
    puede_anular: t.estado === "en_transito",
    items,
  };
}

/** Los datos de transporte del 2.0 (chofer, vehículo…) no tienen columna en Neura: van a la observación. */
export function observacionTraslado(b: Record<string, unknown>): string {
  const partes: string[] = [];
  const t = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  if (t("observacion")) partes.push(t("observacion"));
  const chofer = [t("chofer_nombre"), t("chofer_documento") && `CI ${t("chofer_documento")}`].filter(Boolean).join(" ");
  if (chofer) partes.push(`Chofer: ${chofer}`);
  const vehiculo = [t("vehiculo_marca"), t("vehiculo_chapa")].filter(Boolean).join(" ");
  if (vehiculo) partes.push(`Vehículo: ${vehiculo}`);
  const transp = [t("transportista_nombre"), t("transportista_ruc") && `RUC ${t("transportista_ruc")}`].filter(Boolean).join(" ");
  if (transp) partes.push(`Transportista: ${transp}`);
  if (t("motivo_descripcion")) partes.push(`Motivo: ${t("motivo_descripcion")}`);
  return partes.join(" · ").slice(0, 1000);
}
