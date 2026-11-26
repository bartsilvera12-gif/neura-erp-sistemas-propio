/**
 * Compras con la forma del ERP 2.0 sobre las tablas de Neura (`compras`, `compra_items`).
 *
 * El alta va por `insertCompraMultilinea` de Neura (la de siempre): numera COMP-, mueve stock y
 * genera el asiento contable. Las líneas de "gasto" del 2.0 son líneas sin producto cuya
 * categoría ES la cuenta contable (plan de cuentas de egresos). Las de mercadería llevan la
 * cuenta que se elige en la pantalla.
 */
import type { Pool } from "pg";
import { insertCompraMultilinea, type IvaTipo } from "@/lib/compras/server/compras-pg";
import { generarAsientoEnTx, getConfigContable } from "@/lib/contabilidad/asientos-pg";
import { enTransaccion, ErrorV2, esUuid } from "./server";

/** ¿Ya se corrió el SQL de pagos a proveedores? (hasta entonces, nadie le pagó nada a nadie) */
let pagosOk: boolean | null = null;
export async function hayPagos(pool: Pool): Promise<boolean> {
  if (pagosOk) return true;
  const { rows } = await pool.query<{ ok: boolean }>(`SELECT to_regclass('neura.pagos_proveedores') IS NOT NULL AS ok`);
  pagosOk = rows[0]?.ok ?? false;
  return pagosOk;
}

const IVA_A_NEURA: Record<string, IvaTipo> = { "10%": "10", "5%": "5", exenta: "exenta", EXENTA: "exenta", "10": "10", "5": "5" };
const IVA_A_20: Record<string, string> = { "10": "10%", "5": "5%", exenta: "exenta" };

// ─── Catálogo (categorías de gasto = cuentas de egresos) ──────────────────

export async function catalogos(pool: Pool, empresaId: string) {
  const { rows: cuentas } = await pool.query<{ id: string; cuenta: string; denominacion: string; nivel: number; asentable: boolean }>(
    `SELECT id, cuenta, denominacion, nivel, asentable FROM neura.plan_cuentas
      WHERE empresa_id = $1::uuid AND COALESCE(activo, true) AND cuenta ~ '^5'
      ORDER BY cuenta`,
    [empresaId]
  );
  // Rubros: las cuentas de nivel 3 de egresos; adentro, las cuentas asentables que empiezan igual.
  const rubros = cuentas
    .filter((c) => c.nivel === 3 && !c.asentable)
    .map((r, i) => ({
      id: r.id,
      nombre: `${r.cuenta} · ${titulo(r.denominacion)}`,
      orden: i,
      activo: true,
      es_personal: false,
      subcategorias: cuentas
        .filter((c) => c.asentable && c.cuenta.startsWith(r.cuenta))
        .map((c, j) => ({
          id: c.id,
          nombre: `${c.cuenta} · ${titulo(c.denominacion)}`,
          orden: j,
          activo: true,
          tipo_costo: "variable" as const,
          deducible_iva: true,
          es_personal: false,
        })),
    }))
    .filter((r) => r.subcategorias.length > 0);
  const cfg = await getConfigContable("neura", empresaId);
  const banco = cfg?.cuenta_banco_id
    ? (await pool.query(`SELECT id, denominacion FROM neura.plan_cuentas WHERE id = $1::uuid`, [cfg.cuenta_banco_id])).rows[0]
    : null;
  return {
    rubros,
    sucursales: [{ id: empresaId, nombre: "Casa central", es_principal: true, activa: true }],
    empleados: [],
    cuentas_bancarias: banco
      ? [{ id: banco.id, banco_id: null, banco_nombre: titulo(banco.denominacion), numero: "", moneda: "GS", titular: null, alias: null, activa: true }]
      : [],
    bancos: [],
    ultimos: {},
    mi_sucursal_id: empresaId,
  };
}

/** Cuentas para la mercadería (activo: inventarios) y para gastos, para el selector que suma Neura. */
export async function cuentasCompra(pool: Pool, empresaId: string) {
  const { rows } = await pool.query(
    `SELECT id, cuenta, denominacion FROM neura.plan_cuentas
      WHERE empresa_id = $1::uuid AND COALESCE(activo, true) AND asentable AND (cuenta ~ '^11[3-4]' OR cuenta ~ '^12' OR cuenta ~ '^5')
      ORDER BY (cuenta ~ '^113') DESC, cuenta`,
    [empresaId]
  );
  return rows.map((r) => ({ id: r.id, codigo: r.cuenta, nombre: titulo(r.denominacion) }));
}

function titulo(s: string) {
  const t = (s ?? "").trim();
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

// ─── Lista (compras-gastos) ───────────────────────────────────────────────

export async function listarCompras(pool: Pool, empresaId: string, sp: URLSearchParams) {
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const conPagos = await hayPagos(pool);
  const where = ["c.empresa_id = $1::uuid"];
  const args: unknown[] = [empresaId];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  // Neura no tiene gastos en esta lista (siguen en Gastos y Servicios).
  if (sp.get("origen") === "gasto") where.push("false");
  const estado = sp.get("estado") ?? "";
  if (estado === "anulado") where.push("c.estado = 'anulada'");
  else if (estado === "vigente") where.push("COALESCE(c.estado, '') <> 'anulada'");
  else if (estado === "borrador") where.push("false");
  const desde = sp.get("desde") ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) where.push(`c.fecha >= (${arg(desde)}::date AT TIME ZONE 'America/Asuncion')`);
  const hasta = sp.get("hasta") ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) where.push(`c.fecha < ((${arg(hasta)}::date + 1) AT TIME ZONE 'America/Asuncion')`);
  const prov = sp.get("proveedor") ?? "";
  if (esUuid(prov)) where.push(`c.proveedor_id = ${arg(prov)}::uuid`);
  const tp = sp.get("tipo_pago") ?? "";
  if (tp === "contado" || tp === "credito") where.push(`c.tipo_pago = ${arg(tp)}`);
  const tipo = sp.get("tipo") ?? "";
  const tipoSql = `(CASE WHEN bool_and_merc THEN 'mercaderia' WHEN bool_and_gasto THEN 'gasto' ELSE 'mixta' END)`;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  if (q) {
    const a = arg(`%${q}%`);
    where.push(`(c.numero_control ILIKE ${a} OR COALESCE(c.proveedor_nombre, '') ILIKE ${a} OR COALESCE(c.numero_comprobante, '') ILIKE ${a}
                 OR EXISTS (SELECT 1 FROM neura.compra_items i WHERE i.compra_id = c.id AND (COALESCE(i.producto_nombre, '') ILIKE ${a} OR COALESCE(i.descripcion, '') ILIKE ${a})))`);
  }
  const pagado = conPagos
    ? `COALESCE((SELECT SUM(a.monto) FROM neura.pagos_proveedores_aplicaciones a JOIN neura.pagos_proveedores p ON p.id = a.pago_id
                  WHERE a.compra_id = c.id AND p.estado = 'aplicado'), 0)`
    : "0";
  const base = `
    SELECT c.*, ${pagado}::float AS pagado,
           COALESCE((SELECT SUM(total_linea) FROM neura.compra_items i WHERE i.compra_id = c.id AND i.producto_id IS NOT NULL), 0)::float AS t_merc,
           COALESCE((SELECT SUM(total_linea) FROM neura.compra_items i WHERE i.compra_id = c.id AND i.producto_id IS NULL), 0)::float AS t_gasto,
           (SELECT count(*) FROM neura.compra_items i WHERE i.compra_id = c.id AND i.producto_id IS NOT NULL)::int AS n_prod,
           COALESCE((SELECT bool_and(producto_id IS NOT NULL) FROM neura.compra_items i WHERE i.compra_id = c.id), c.producto_id IS NOT NULL) AS bool_and_merc,
           COALESCE((SELECT bool_and(producto_id IS NULL) FROM neura.compra_items i WHERE i.compra_id = c.id), c.producto_id IS NULL) AS bool_and_gasto,
           (SELECT string_agg(DISTINCT i.descripcion, ', ') FROM neura.compra_items i WHERE i.compra_id = c.id AND i.producto_id IS NULL) AS cats,
           oc.numero AS oc_numero
      FROM neura.compras c
      LEFT JOIN neura.ordenes_compra oc ON oc.id = c.orden_compra_id
     WHERE ${where.join(" AND ")}`;
  const filtroTipo = tipo === "mercaderia" || tipo === "gasto" || tipo === "mixta" ? `WHERE ${tipoSql} = ${arg(tipo)}` : "";
  const n = args.length;
  const lim = arg(porPagina);
  const off = arg((pagina - 1) * porPagina);
  const { rows } = await pool.query(
    `SELECT x.*, ${tipoSql} AS tipo_calc FROM (${base}) x ${filtroTipo} ORDER BY x.fecha DESC, x.numero_control DESC LIMIT ${lim} OFFSET ${off}`,
    args
  );
  const { rows: tot } = await pool.query(
    `SELECT count(*)::int AS n, COALESCE(SUM(total) FILTER (WHERE COALESCE(estado,'') <> 'anulada'), 0)::float AS monto,
            COALESCE(SUM(t_merc) FILTER (WHERE COALESCE(estado,'') <> 'anulada'), 0)::float AS merc,
            COALESCE(SUM(t_gasto) FILTER (WHERE COALESCE(estado,'') <> 'anulada'), 0)::float AS gasto,
            COALESCE(SUM(monto_iva) FILTER (WHERE COALESCE(estado,'') <> 'anulada'), 0)::float AS iva
       FROM (${base}) x ${filtroTipo}`,
    args.slice(0, n)
  );
  return {
    rows: rows.map((r) => {
      const credito = r.tipo_pago === "credito";
      const total = Number(r.total) || 0;
      const saldo = Math.max(0, total - Number(r.pagado));
      return {
        origen: "compra",
        id: r.id,
        numero: r.numero_control,
        estado: r.estado === "anulada" ? "anulado" : "vigente",
        tipo: r.tipo_calc,
        fecha: r.fecha,
        proveedor_id: r.proveedor_id,
        proveedor_nombre: r.proveedor_nombre,
        con_comprobante: !!(r.numero_comprobante || r.nro_timbrado),
        tipo_comprobante: r.tipo_comprobante ?? "Factura",
        comprobante: r.numero_comprobante,
        tipo_pago: r.tipo_pago === "credito" ? "credito" : "contado",
        medio_pago: null,
        vencimiento: credito ? addDias(r.fecha, r.plazo_dias) : null,
        moneda: r.moneda === "USD" ? "USD" : "GS",
        total,
        total_gs: total,
        total_mercaderia: r.t_merc || (r.bool_and_merc ? total : 0),
        total_gastos: r.t_gasto,
        descripcion: null,
        sucursal_nombre: null,
        productos: r.n_prod || (r.producto_id ? 1 : 0),
        categorias: r.cats,
        cxp: credito && r.estado !== "anulada"
          ? { id: r.id, saldo, pagado: Number(r.pagado), estado: saldo <= 0 ? "pagada" : Number(r.pagado) > 0 ? "parcial" : "pendiente", moneda: "GS" }
          : null,
        oc_numero: r.oc_numero,
        adjuntos: r.documento_path ? 1 : 0,
        recurrente_id: null,
        fecha_programada: null,
        anulado_motivo: null,
      };
    }),
    total: tot[0]?.n ?? 0,
    total_monto: tot[0]?.monto ?? 0,
    total_mercaderia: tot[0]?.merc ?? 0,
    total_gastos: tot[0]?.gasto ?? 0,
    total_iva: tot[0]?.iva ?? 0,
    total_borradores: 0,
    borradores: 0,
  };
}

const addDias = (fecha: string | Date, dias: number | null) => {
  const d = new Date(fecha);
  d.setDate(d.getDate() + (Number(dias) || 0));
  return d.toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
};

// ─── Detalle ──────────────────────────────────────────────────────────────

export async function detalleCompra(pool: Pool, empresaId: string, id: string) {
  const { rows } = await pool.query(
    `SELECT c.*, oc.numero AS oc_numero FROM neura.compras c LEFT JOIN neura.ordenes_compra oc ON oc.id = c.orden_compra_id
      WHERE c.id = $1::uuid AND c.empresa_id = $2::uuid`,
    [id, empresaId]
  );
  const c = rows[0];
  if (!c) throw new ErrorV2("Compra no encontrada", 404);
  const { rows: its } = await pool.query(
    `SELECT i.*, p.sku FROM neura.compra_items i LEFT JOIN neura.productos p ON p.id = i.producto_id
      WHERE i.compra_id = $1::uuid ORDER BY i.orden_linea NULLS LAST, i.created_at`,
    [id]
  );
  // Compras viejas de una sola línea: el producto está en la cabecera.
  const lineas = its.length
    ? its
    : c.producto_id
      ? [{ id: c.id, producto_id: c.producto_id, producto_nombre: c.producto_nombre, sku: null, cantidad: c.cantidad, costo_unitario: c.costo_unitario,
           iva_tipo: c.iva_tipo, subtotal: c.subtotal, monto_iva: c.monto_iva, total_linea: c.total, descripcion: null }]
      : [];
  const items = lineas
    .filter((l) => l.producto_id)
    .map((l) => ({
      id: l.id,
      producto_id: l.producto_id,
      producto_nombre: l.producto_nombre,
      producto_sku: l.sku ?? null,
      cantidad: Number(l.cantidad),
      costo_unitario_original: Number(l.costo_unitario),
      costo_unitario: Number(l.costo_unitario),
      tipo_iva: IVA_A_20[l.iva_tipo] ?? "10%",
      subtotal: Number(l.subtotal),
      monto_iva: Number(l.monto_iva),
      total: Number(l.total_linea),
      precio_venta_nuevo: null,
    }));
  const gastos = lineas
    .filter((l) => !l.producto_id)
    .map((l, i) => ({
      id: l.id,
      orden: i,
      categoria_id: l.cuenta_contable_id ?? null,
      categoria_nombre: l.descripcion ?? null,
      descripcion: l.descripcion ?? "",
      monto_original: Number(l.total_linea),
      monto: Number(l.total_linea),
      iva_tipo: (IVA_A_20[l.iva_tipo] ?? "10%") as "10%" | "5%" | "exenta",
      monto_iva: Number(l.monto_iva),
      deducible: true,
      sucursal_id: null,
      empleado_id: null,
    }));
  const iva = (t: string) => lineas.filter((l) => l.iva_tipo === t);
  const sum = (ls: typeof lineas, k: string) => ls.reduce((a, l) => a + Number(l[k] ?? 0), 0);
  let cuenta_pagar = null;
  if (c.tipo_pago === "credito" && (await hayPagos(pool))) {
    const { rows: pagos } = await pool.query(
      `SELECT p.id, p.numero, p.fecha::text AS fecha, a.monto::float AS monto, p.anulado_at
         FROM neura.pagos_proveedores_aplicaciones a JOIN neura.pagos_proveedores p ON p.id = a.pago_id
        WHERE a.compra_id = $1::uuid ORDER BY p.fecha, p.numero`,
      [id]
    );
    const pagado = pagos.filter((p) => !p.anulado_at).reduce((a, p) => a + p.monto, 0);
    const total = Number(c.total);
    cuenta_pagar = {
      id: c.id,
      numero: c.numero_comprobante ?? c.numero_control,
      fecha_emision: new Date(c.fecha).toLocaleDateString("en-CA", { timeZone: "America/Asuncion" }),
      vencimiento: addDias(c.fecha, c.plazo_dias),
      moneda: "GS",
      monto: total,
      pagado,
      saldo: Math.max(0, total - pagado),
      estado: c.estado === "anulada" ? "anulada" : total - pagado <= 0 ? "pagada" : pagado > 0 ? "parcial" : "pendiente",
      pagos,
    };
  }
  return {
    id: c.id,
    numero_control: c.numero_control,
    proveedor_id: c.proveedor_id,
    proveedor_nombre: c.proveedor_nombre,
    fecha: c.fecha,
    fecha_factura: null,
    nro_timbrado: c.nro_timbrado,
    numero_factura: c.numero_comprobante,
    tipo: items.length && gastos.length ? "mixta" : gastos.length ? "gasto" : "mercaderia",
    sucursal_id: null,
    sucursal: null,
    con_comprobante: !!(c.numero_comprobante || c.nro_timbrado),
    tipo_comprobante: c.tipo_comprobante ?? "Factura",
    cuenta_bancaria_id: null,
    cuenta: null,
    total_mercaderia: sum(lineas.filter((l) => l.producto_id), "total_linea"),
    total_gastos: sum(lineas.filter((l) => !l.producto_id), "total_linea"),
    exenta: sum(iva("exenta"), "total_linea"),
    total_5: sum(iva("5"), "total_linea"),
    iva_5: sum(iva("5"), "monto_iva"),
    total_10: sum(iva("10"), "total_linea"),
    iva_10: sum(iva("10"), "monto_iva"),
    iva_credito: Number(c.monto_iva),
    gastos,
    tipo_pago: c.tipo_pago === "credito" ? "credito" : "contado",
    medio_pago: null,
    referencia_pago: null,
    plazo_dias: c.plazo_dias,
    vencimiento: c.tipo_pago === "credito" ? addDias(c.fecha, c.plazo_dias) : null,
    moneda: c.moneda === "USD" ? "USD" : "GS",
    tipo_cambio: Number(c.tipo_cambio) || 1,
    subtotal: Number(c.subtotal),
    monto_iva: Number(c.monto_iva),
    total: Number(c.total),
    estado: c.estado === "anulada" ? "anulada" : "registrada",
    observacion: null,
    usuario_nombre: c.usuario_nombre,
    anulada_at: null,
    anulada_por: null,
    anulada_motivo: null,
    orden_compra_id: c.orden_compra_id,
    oc: c.oc_numero ? { numero_oc: c.oc_numero } : null,
    deposito_id: null,
    deposito: null,
    items,
    cuenta_pagar,
  };
}

// ─── Alta ─────────────────────────────────────────────────────────────────

export interface QuienCompra {
  empresaId: string;
  usuarioId: string;
  nombre: string;
}

/**
 * Body del 2.0 → compra multilínea de Neura. La cuenta de cada línea de mercadería viene en
 * `items[].cuenta_contable_id` (el campo que suma Neura); la de un gasto es su categoría.
 */
export async function crearCompra(pool: Pool, q: QuienCompra, b: Record<string, unknown>) {
  if (!esUuid(b.proveedor_id)) throw new ErrorV2("Elegí el proveedor");
  const { rows: pr } = await pool.query(`SELECT id, nombre FROM neura.proveedores WHERE id = $1::uuid AND empresa_id = $2::uuid`, [
    b.proveedor_id,
    q.empresaId,
  ]);
  if (!pr[0]) throw new ErrorV2("Proveedor no encontrado");
  const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
  const gastos = Array.isArray(b.gastos) ? (b.gastos as Record<string, unknown>[]) : [];
  if (items.length + gastos.length === 0) throw new ErrorV2("La compra no tiene líneas");
  const moneda = b.moneda === "USD" ? "USD" : "PYG";
  const cambio = moneda === "USD" ? Number(b.tipo_cambio) || 0 : 1;
  if (moneda === "USD" && !(cambio > 0)) throw new ErrorV2("Falta el tipo de cambio");
  const credito = b.tipo_pago === "credito";
  const cfg = await getConfigContable("neura", q.empresaId);
  const efectivo = !credito && (b.medio_pago ?? "efectivo") === "efectivo";
  const contrapartida = credito ? cfg?.cuenta_proveedores_id : efectivo ? cfg?.cuenta_caja_id : cfg?.cuenta_banco_id;
  if (!contrapartida) {
    throw new ErrorV2(
      credito ? "Falta configurar la cuenta de Proveedores en Configuración contable." : "Falta configurar la cuenta de Caja/Banco en Configuración contable."
    );
  }
  const nombres = new Map<string, string>();
  const ids = items.map((i) => i.producto_id).filter(esUuid);
  if (ids.length) {
    const { rows } = await pool.query(`SELECT id, nombre FROM neura.productos WHERE id = ANY($1::uuid[]) AND empresa_id = $2::uuid`, [ids, q.empresaId]);
    for (const r of rows) nombres.set(r.id, r.nombre);
  }
  const cuentasGasto = new Map<string, string>();
  const catIds = gastos.map((g) => g.categoria_id).filter(esUuid);
  if (catIds.length) {
    const { rows } = await pool.query(`SELECT id, cuenta, denominacion FROM neura.plan_cuentas WHERE id = ANY($1::uuid[]) AND empresa_id = $2::uuid`, [catIds, q.empresaId]);
    for (const r of rows) cuentasGasto.set(r.id, `${r.cuenta} · ${titulo(r.denominacion)}`);
  }
  const lineas = [
    ...items.map((it, i) => {
      if (!esUuid(it.producto_id) || !nombres.has(it.producto_id)) throw new ErrorV2(`Línea ${i + 1}: producto no encontrado`);
      if (!esUuid(it.cuenta_contable_id)) throw new ErrorV2(`"${nombres.get(it.producto_id)}": elegí la cuenta contable`);
      const precio = Number(it.precio_venta_nuevo);
      return {
        producto_id: it.producto_id as string,
        producto_nombre: nombres.get(it.producto_id as string)!,
        descripcion: null,
        cantidad: Number(it.cantidad),
        costo_unitario: Math.round(Number(it.costo_unitario) * cambio),
        iva_tipo: IVA_A_NEURA[String(it.iva_tipo ?? "10%")] ?? ("10" as IvaTipo),
        cuenta_contable_id: it.cuenta_contable_id as string,
        recepcion_item_id: null,
        precio_venta: precio > 0 ? precio : null,
        margen_venta: null,
      };
    }),
    ...gastos.map((g, i) => {
      if (!esUuid(g.categoria_id) || !cuentasGasto.has(g.categoria_id)) throw new ErrorV2(`Gasto ${i + 1}: elegí la categoría`);
      const monto = Number(g.monto);
      if (!(monto > 0)) throw new ErrorV2(`Gasto ${i + 1}: el monto tiene que ser mayor a 0`);
      return {
        producto_id: null,
        producto_nombre: "",
        descripcion: String(g.descripcion ?? "").trim() || cuentasGasto.get(g.categoria_id as string)!,
        cantidad: 1,
        costo_unitario: Math.round(monto * cambio),
        iva_tipo: IVA_A_NEURA[String(g.iva_tipo ?? "10%")] ?? ("10" as IvaTipo),
        cuenta_contable_id: g.categoria_id as string,
        recepcion_item_id: null,
      };
    }),
  ];
  const r = await insertCompraMultilinea("neura", q.empresaId, {
    proveedor_id: pr[0].id,
    proveedor_nombre: pr[0].nombre,
    orden_compra_id: esUuid(b.orden_compra_id) ? (b.orden_compra_id as string) : null,
    origen_compra: "directa",
    moneda,
    tipo_cambio: cambio,
    tipo_pago: credito ? "credito" : "contado",
    plazo_dias: credito ? Number(b.plazo_dias) || 0 : null,
    cuotas: credito ? 1 : null,
    nro_timbrado: String(b.nro_timbrado ?? "").trim(),
    numero_comprobante: typeof b.numero_factura === "string" && b.numero_factura.trim() ? b.numero_factura.trim() : null,
    tipo_comprobante: typeof b.tipo_comprobante === "string" ? b.tipo_comprobante : b.con_comprobante === false ? "Sin comprobante" : "Factura",
    cuenta_contrapartida_id: contrapartida,
    items: lineas,
    idempotency_key: esUuid(b.idempotency_key) ? (b.idempotency_key as string) : null,
    created_by: q.usuarioId,
    usuario_nombre: q.nombre,
    ubicacion_id: esUuid(b.deposito_id) ? (b.deposito_id as string) : null,
  });
  return { id: r.compra.id, numero_control: r.compra.numero_control, total: Number(r.compra.total), tipo: gastos.length && items.length ? "mixta" : gastos.length ? "gasto" : "mercaderia" };
}

/**
 * Anular una compra: la mercadería sale del depósito predeterminado (si ya no está, no se puede),
 * asiento inverso y la compra queda "anulada". No se puede con pagos aplicados ni si entró por una
 * recepción de orden de compra.
 */
export async function anularCompra(pool: Pool, q: QuienCompra, id: string, motivo: string) {
  const conPagos = await hayPagos(pool);
  return enTransaccion(pool, async (t) => {
    const { rows } = await t.query(`SELECT * FROM neura.compras WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`, [id, q.empresaId]);
    const co = rows[0];
    if (!co) throw new ErrorV2("Compra no encontrada", 404);
    if (co.estado === "anulada") throw new ErrorV2(`La compra ${co.numero_control} ya está anulada`);
    if (co.origen_compra === "recepcion") throw new ErrorV2("Esta compra viene de una recepción de orden de compra: no se anula desde acá.");
    if (conPagos) {
      const { rows: p } = await t.query(
        `SELECT 1 FROM neura.pagos_proveedores_aplicaciones a JOIN neura.pagos_proveedores p ON p.id = a.pago_id
          WHERE a.compra_id = $1::uuid AND p.estado = 'aplicado' LIMIT 1`,
        [id]
      );
      if (p.length) throw new ErrorV2("La compra tiene pagos aplicados: anulá primero esos pagos.");
    }
    // La mercadería que entró vuelve a salir (del depósito predeterminado).
    if (co.afecta_stock !== false) {
      const { rows: its } = await t.query(
        `SELECT producto_id, SUM(cantidad)::float AS cantidad, MAX(costo_unitario)::float AS costo FROM neura.compra_items
          WHERE compra_id = $1::uuid AND producto_id IS NOT NULL GROUP BY producto_id`,
        [id]
      );
      const lineas = its.length ? its : co.producto_id ? [{ producto_id: co.producto_id, cantidad: Number(co.cantidad), costo: Number(co.costo_unitario) }] : [];
      if (lineas.length) {
        const { rows: dep } = await t.query(`SELECT neura.inv_deposito_predeterminado($1::uuid) AS id`, [q.empresaId]);
        for (const l of lineas) {
          await t.query(
            `SELECT neura.inv_mover($1::uuid, $2::uuid, $3::uuid, $4, $5, 'ajuste', 'compra_anulacion', $6::uuid, $7, $8, $9::uuid, $10)`,
            [q.empresaId, l.producto_id, dep[0].id, -Number(l.cantidad), l.costo, id, co.numero_control, `Anulación ${co.numero_control}: ${motivo.slice(0, 150)}`, q.usuarioId, q.nombre]
          );
        }
      }
    }
    if (co.asiento_contable_id) {
      const { rows: det } = await t.query(
        `SELECT cuenta_contable_id, proveedor_id, descripcion, debe::float AS debe, haber::float AS haber
           FROM neura.asientos_contables_detalles WHERE asiento_id = $1::uuid`,
        [co.asiento_contable_id]
      );
      await generarAsientoEnTx(t, "neura", q.empresaId, {
        origen_tipo: "reversion",
        origen_id: id,
        evento_origen: "anulacion_compra",
        fecha_contable: new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" }),
        glosa: `Anulación de la compra ${co.numero_control}: ${motivo.slice(0, 200)}`,
        asiento_original_id: co.asiento_contable_id,
        lineas: det.map((d) => ({ cuenta_contable_id: d.cuenta_contable_id, proveedor_id: d.proveedor_id, descripcion: d.descripcion, debe: d.haber, haber: d.debe, documento_tipo: "compra", documento_id: id })),
        createdBy: q.usuarioId,
      });
    }
    await t.query(`UPDATE neura.compras SET estado = 'anulada', estado_contable = CASE WHEN asiento_contable_id IS NULL THEN estado_contable ELSE 'revertido' END, updated_at = now() WHERE id = $1::uuid`, [id]);
    return { id, numero_control: co.numero_control, estado: "anulada" };
  });
}
