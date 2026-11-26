/**
 * Cuentas por pagar y pagos a proveedores con la forma del ERP 2.0.
 *
 * Lo que se debe sale de las compras a crédito de Neura (`compras.tipo_pago = 'credito'`):
 * monto = total de la compra, pagado = lo aplicado de pagos no anulados (tablas
 * `pagos_proveedores*`, migración 20261126180000). La "cuenta a pagar" del 2.0 es la compra
 * misma: su id es el de la compra.
 *
 * Cada pago genera su asiento con el motor contable de Neura: Proveedores al Debe, Caja
 * (efectivo) o Banco (el resto) al Haber. Anular genera el asiento inverso.
 */
import type { Pool, PoolClient } from "pg";
import { generarAsientoEnTx, getConfigContable } from "@/lib/contabilidad/asientos-pg";
import { hayPagos } from "./compras";
import { enTransaccion, ErrorV2, esUuid } from "./server";

const HOY = `(now() AT TIME ZONE 'America/Asuncion')::date`;

async function exigirPagos(pool: Pool) {
  if (!(await hayPagos(pool))) throw new ErrorV2("Falta correr el SQL de pagos a proveedores para registrar pagos.");
}

/** Una fila por compra a crédito, con lo pagado y lo que queda. */
function sqlCuentas(conPagos: boolean) {
  const pagado = conPagos
    ? `COALESCE((SELECT SUM(a.monto) FROM neura.pagos_proveedores_aplicaciones a JOIN neura.pagos_proveedores p ON p.id = a.pago_id
                  WHERE a.compra_id = c.id AND p.estado = 'aplicado'), 0)`
    : "0";
  return `
    SELECT c.id, c.id AS compra_id, NULL::uuid AS gasto_id, c.proveedor_id, c.numero_control AS compra_numero,
           COALESCE(NULLIF(c.numero_comprobante, ''), c.numero_control) AS numero,
           (c.fecha AT TIME ZONE 'America/Asuncion')::date AS fecha_emision,
           ((c.fecha AT TIME ZONE 'America/Asuncion')::date + COALESCE(c.plazo_dias, 0)) AS vencimiento,
           CASE WHEN c.moneda = 'USD' THEN 'USD' ELSE 'GS' END AS moneda,
           c.total::float AS monto, ${pagado}::float AS pagado,
           CASE WHEN c.estado = 'anulada' THEN true ELSE false END AS anulada,
           COALESCE(c.proveedor_nombre, pr.nombre) AS proveedor_nombre, pr.ruc AS proveedor_ruc, pr.telefono AS proveedor_telefono
      FROM neura.compras c
      LEFT JOIN neura.proveedores pr ON pr.id = c.proveedor_id
     WHERE c.empresa_id = $1::uuid AND c.tipo_pago = 'credito'`;
}

function conEstado<T extends { monto: number; pagado: number; anulada: boolean; vencimiento: string | Date }>(r: T) {
  const saldo = Math.max(0, Math.round((r.monto - r.pagado) * 100) / 100);
  const venc = typeof r.vencimiento === "string" ? r.vencimiento : r.vencimiento.toISOString().slice(0, 10);
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  const dias = Math.round((Date.parse(hoy) - Date.parse(venc)) / 86400000);
  const estado = r.anulada ? "anulada" : saldo <= 0 ? "pagada" : r.pagado > 0 ? "parcial" : "pendiente";
  const abierta = estado === "pendiente" || estado === "parcial";
  return {
    ...r,
    vencimiento: venc,
    fecha_emision: typeof (r as { fecha_emision?: unknown }).fecha_emision === "string"
      ? (r as unknown as { fecha_emision: string }).fecha_emision
      : new Date((r as unknown as { fecha_emision: Date }).fecha_emision).toISOString().slice(0, 10),
    saldo,
    estado,
    dias_atraso: abierta ? Math.max(0, dias) : 0,
    dias_para_vencer: abierta ? Math.max(0, -dias) : 0,
  };
}

// ─── Cuentas por pagar ────────────────────────────────────────────────────

export async function listarCuentasPagar(pool: Pool, empresaId: string, sp: URLSearchParams) {
  const conPagos = await hayPagos(pool);
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const moneda = sp.get("moneda") === "USD" ? "USD" : "GS";
  const { rows } = await pool.query(sqlCuentas(conPagos), [empresaId]);
  const todas = rows.map(conEstado).filter((r) => r.moneda === moneda);
  const estado = sp.get("estado") ?? "";
  const prov = sp.get("proveedor") ?? "";
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  let lista = todas.filter((r) => (estado === "todas" ? true : estado ? r.estado === estado || (estado === "vencidas" && r.dias_atraso > 0 && r.saldo > 0) : r.saldo > 0 && r.estado !== "anulada"));
  if (esUuid(prov)) lista = lista.filter((r) => r.proveedor_id === prov);
  if (q) lista = lista.filter((r) => `${r.proveedor_nombre} ${r.numero} ${r.compra_numero} ${r.proveedor_ruc ?? ""}`.toLowerCase().includes(q));
  lista.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.numero.localeCompare(b.numero));
  const abiertas = todas.filter((r) => r.saldo > 0 && r.estado !== "anulada");
  const ant = { por_vencer: 0, vence_semana: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, proveedores: 0, total: 0, pagado_mes: 0 };
  for (const r of abiertas) {
    ant.total += r.saldo;
    if (r.dias_atraso <= 0) {
      if (r.dias_para_vencer <= 7) ant.vence_semana += r.saldo;
      else ant.por_vencer += r.saldo;
    } else if (r.dias_atraso <= 30) ant.d1_30 += r.saldo;
    else if (r.dias_atraso <= 60) ant.d31_60 += r.saldo;
    else if (r.dias_atraso <= 90) ant.d61_90 += r.saldo;
    else ant.d90 += r.saldo;
  }
  ant.proveedores = new Set(abiertas.map((r) => r.proveedor_id)).size;
  if (conPagos) {
    const { rows: m } = await pool.query(
      `SELECT COALESCE(SUM(total), 0)::float AS n FROM neura.pagos_proveedores
        WHERE empresa_id = $1::uuid AND estado = 'aplicado' AND date_trunc('month', fecha) = date_trunc('month', ${HOY})
          AND (CASE WHEN moneda = 'USD' THEN 'USD' ELSE 'GS' END) = $2`,
      [empresaId, moneda]
    );
    ant.pagado_mes = m[0]?.n ?? 0;
  }
  return {
    total: lista.length,
    total_saldo: lista.reduce((a, r) => a + r.saldo, 0),
    rows: lista.slice((pagina - 1) * porPagina, pagina * porPagina),
    antiguedad: ant,
  };
}

export async function estadoCuenta(pool: Pool, empresaId: string, proveedorId: string) {
  const conPagos = await hayPagos(pool);
  const { rows } = await pool.query(`${sqlCuentas(conPagos)} AND c.proveedor_id = $2::uuid ORDER BY c.fecha`, [empresaId, proveedorId]);
  const cuentas = rows.map(conEstado);
  let pagos: unknown[] = [];
  if (conPagos) {
    const { rows: ps } = await pool.query(
      `SELECT p.id, p.numero, p.fecha::text AS fecha, CASE WHEN p.moneda = 'USD' THEN 'USD' ELSE 'GS' END AS moneda,
              p.total::float AS total, p.observacion, p.usuario_nombre AS usuario, p.anulado_at, p.anulado_motivo,
              (SELECT json_agg(json_build_object('metodo', m.metodo, 'monto', m.monto::float, 'referencia', m.referencia))
                 FROM neura.pagos_proveedores_medios m WHERE m.pago_id = p.id) AS medios,
              (SELECT json_agg(json_build_object('numero', COALESCE(NULLIF(c.numero_comprobante, ''), c.numero_control), 'monto', a.monto::float))
                 FROM neura.pagos_proveedores_aplicaciones a JOIN neura.compras c ON c.id = a.compra_id WHERE a.pago_id = p.id) AS aplicado_a
         FROM neura.pagos_proveedores p
        WHERE p.empresa_id = $1::uuid AND p.proveedor_id = $2::uuid
        ORDER BY p.fecha DESC, p.numero DESC`,
      [empresaId, proveedorId]
    );
    pagos = ps;
  }
  const abiertas = cuentas.filter((c) => c.estado === "pendiente" || c.estado === "parcial");
  const suma = (m: string, venc = false) =>
    abiertas.filter((c) => c.moneda === m && (!venc || c.dias_atraso > 0)).reduce((a, c) => a + c.saldo, 0);
  return { cuentas, pagos, deuda_gs: suma("GS"), deuda_usd: suma("USD"), vencido_gs: suma("GS", true) };
}

// ─── Pagos ────────────────────────────────────────────────────────────────

const COLS_PAGO = `p.id, p.numero, p.proveedor_id, COALESCE(pr.nombre_comercial, pr.nombre) AS proveedor_nombre, p.fecha::text AS fecha,
  CASE WHEN p.moneda = 'USD' THEN 'USD' ELSE 'GS' END AS moneda, p.total::float AS total, NULL AS caja_id, p.observacion,
  p.usuario_nombre, p.anulado_at, p.anulado_por_nombre AS anulado_por, p.anulado_motivo,
  COALESCE((SELECT json_agg(json_build_object('metodo', m.metodo, 'monto', m.monto::float, 'referencia', m.referencia))
              FROM neura.pagos_proveedores_medios m WHERE m.pago_id = p.id), '[]') AS medios`;

export async function listarPagos(pool: Pool, empresaId: string, sp: URLSearchParams) {
  if (!(await hayPagos(pool))) return { rows: [], total: 0 };
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const where = ["p.empresa_id = $1::uuid"];
  const args: unknown[] = [empresaId];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  const prov = sp.get("proveedor") ?? "";
  if (esUuid(prov)) where.push(`p.proveedor_id = ${arg(prov)}::uuid`);
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    const a = arg(`%${q}%`);
    where.push(`(p.numero ILIKE ${a} OR pr.nombre ILIKE ${a} OR COALESCE(pr.nombre_comercial, '') ILIKE ${a})`);
  }
  const desde = sp.get("desde") ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) where.push(`p.fecha >= ${arg(desde)}::date`);
  const hasta = sp.get("hasta") ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) where.push(`p.fecha <= ${arg(hasta)}::date`);
  const w = where.join(" AND ");
  const n = args.length;
  const lim = arg(porPagina);
  const off = arg((pagina - 1) * porPagina);
  const [{ rows }, { rows: tot }] = await Promise.all([
    pool.query(`SELECT ${COLS_PAGO} FROM neura.pagos_proveedores p JOIN neura.proveedores pr ON pr.id = p.proveedor_id
                 WHERE ${w} ORDER BY p.fecha DESC, p.numero DESC LIMIT ${lim} OFFSET ${off}`, args),
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM neura.pagos_proveedores p JOIN neura.proveedores pr ON pr.id = p.proveedor_id WHERE ${w}`, args.slice(0, n)),
  ]);
  return { rows, total: tot[0]?.n ?? 0 };
}

export async function detallePago(pool: Pool, empresaId: string, id: string) {
  await exigirPagos(pool);
  const { rows } = await pool.query(
    `SELECT ${COLS_PAGO},
            COALESCE((SELECT json_agg(json_build_object('monto', a.monto::float, 'cxp_id', a.compra_id, 'compra_id', a.compra_id,
                        'numero', COALESCE(NULLIF(c.numero_comprobante, ''), c.numero_control), 'compra_numero', c.numero_control))
                        FROM neura.pagos_proveedores_aplicaciones a JOIN neura.compras c ON c.id = a.compra_id WHERE a.pago_id = p.id), '[]') AS aplicaciones
       FROM neura.pagos_proveedores p JOIN neura.proveedores pr ON pr.id = p.proveedor_id
      WHERE p.id = $1::uuid AND p.empresa_id = $2::uuid`,
    [id, empresaId]
  );
  if (!rows[0]) throw new ErrorV2("Pago no encontrado", 404);
  return rows[0];
}

export interface Quien {
  empresaId: string;
  usuarioId: string;
  nombre: string;
}

async function siguienteNumero(c: PoolClient, empresaId: string) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('pago_prov:' || $1, 0))`, [empresaId]);
  const { rows } = await c.query<{ n: string | null }>(
    `SELECT max(substring(numero from '[0-9]+$')::bigint) AS n FROM neura.pagos_proveedores WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  return `PP-${String(Number(rows[0]?.n ?? 0) + 1).padStart(6, "0")}`;
}

/**
 * Registra un pago: medios (cómo se pagó) y aplicaciones (a qué compras). Ninguna aplicación
 * puede pasar el saldo de su compra. Todo en una transacción, con su asiento.
 */
export async function registrarPago(pool: Pool, q: Quien, b: Record<string, unknown>) {
  await exigirPagos(pool);
  if (!esUuid(b.proveedor_id)) throw new ErrorV2("Elegí el proveedor");
  const medios = (Array.isArray(b.medios) ? b.medios : []) as { metodo?: string; monto?: number; referencia?: string | null }[];
  const aplic = (Array.isArray(b.aplicaciones) ? b.aplicaciones : []) as { cxp_id?: string; monto?: number }[];
  const ms = medios.map((m) => ({ metodo: String(m.metodo ?? ""), monto: Number(m.monto) || 0, referencia: m.referencia?.trim() || null })).filter((m) => m.monto > 0);
  const as = aplic.map((a) => ({ compra: String(a.cxp_id ?? ""), monto: Number(a.monto) || 0 })).filter((a) => a.monto > 0);
  if (!ms.length) throw new ErrorV2("Cargá cómo se pagó");
  if (!as.length) throw new ErrorV2("Elegí qué facturas se pagan");
  if (ms.some((m) => !["efectivo", "transferencia", "cheque", "tarjeta", "otro"].includes(m.metodo))) throw new ErrorV2("Medio de pago inválido");
  if (as.some((a) => !esUuid(a.compra))) throw new ErrorV2("Factura inválida");
  const total = ms.reduce((a, m) => a + m.monto, 0);
  const aplicado = as.reduce((a, x) => a + x.monto, 0);
  if (Math.round(total) !== Math.round(aplicado)) throw new ErrorV2("Lo que se paga tiene que ser igual a lo aplicado a las facturas");
  const cfg = await getConfigContable("neura", q.empresaId);
  if (!cfg?.cuenta_proveedores_id) throw new ErrorV2("Falta configurar la cuenta de Proveedores en Configuración contable.");
  if (ms.some((m) => m.metodo === "efectivo") && !cfg.cuenta_caja_id) throw new ErrorV2("Falta configurar la cuenta de Caja en Configuración contable.");
  if (ms.some((m) => m.metodo !== "efectivo") && !cfg.cuenta_banco_id) throw new ErrorV2("Falta configurar la cuenta de Banco en Configuración contable.");
  const idem = esUuid(b.idempotency_key) ? (b.idempotency_key as string) : null;

  return enTransaccion(pool, async (c) => {
    if (idem) {
      const { rows } = await c.query(`SELECT id, numero, total::float AS total FROM neura.pagos_proveedores WHERE empresa_id = $1::uuid AND idempotency_key = $2::uuid`, [q.empresaId, idem]);
      if (rows[0]) return { ...rows[0], repetido: true };
    }
    const { rows: pr } = await c.query(`SELECT id, nombre FROM neura.proveedores WHERE id = $1::uuid AND empresa_id = $2::uuid`, [b.proveedor_id, q.empresaId]);
    if (!pr[0]) throw new ErrorV2("Proveedor no encontrado");
    // Cada compra: del proveedor, a crédito, vigente, y con saldo suficiente (con candado).
    for (const a of as) {
      const { rows } = await c.query(
        `SELECT c.id, c.numero_control, c.total::float AS total, c.proveedor_id, c.tipo_pago, c.estado,
                COALESCE((SELECT SUM(x.monto) FROM neura.pagos_proveedores_aplicaciones x JOIN neura.pagos_proveedores p ON p.id = x.pago_id
                           WHERE x.compra_id = c.id AND p.estado = 'aplicado'), 0)::float AS pagado
           FROM neura.compras c WHERE c.id = $1::uuid AND c.empresa_id = $2::uuid FOR UPDATE`,
        [a.compra, q.empresaId]
      );
      const co = rows[0];
      if (!co) throw new ErrorV2("Factura no encontrada");
      if (co.proveedor_id !== b.proveedor_id) throw new ErrorV2(`${co.numero_control} es de otro proveedor`);
      if (co.tipo_pago !== "credito" || co.estado === "anulada") throw new ErrorV2(`${co.numero_control} no tiene nada pendiente`);
      if (a.monto > co.total - co.pagado + 0.5) throw new ErrorV2(`${co.numero_control}: se debe ${Math.round(co.total - co.pagado).toLocaleString("es-PY")}`);
    }
    const numero = await siguienteNumero(c, q.empresaId);
    const moneda = b.moneda === "USD" ? "USD" : "PYG";
    const { rows: pago } = await c.query<{ id: string }>(
      `INSERT INTO neura.pagos_proveedores (empresa_id, numero, proveedor_id, moneda, total, observacion, idempotency_key, created_by, usuario_nombre)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::uuid, $8::uuid, $9) RETURNING id`,
      [q.empresaId, numero, b.proveedor_id, moneda, total, typeof b.observacion === "string" ? b.observacion.trim().slice(0, 1000) || null : null, idem, q.usuarioId, q.nombre]
    );
    const pagoId = pago[0].id;
    for (const m of ms) {
      await c.query(`INSERT INTO neura.pagos_proveedores_medios (empresa_id, pago_id, metodo, monto, referencia) VALUES ($1::uuid, $2::uuid, $3, $4, $5)`, [
        q.empresaId, pagoId, m.metodo, m.monto, m.referencia,
      ]);
    }
    for (const a of as) {
      await c.query(`INSERT INTO neura.pagos_proveedores_aplicaciones (empresa_id, pago_id, compra_id, monto) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)`, [
        q.empresaId, pagoId, a.compra, a.monto,
      ]);
    }
    const efectivo = ms.filter((m) => m.metodo === "efectivo").reduce((a, m) => a + m.monto, 0);
    const banco = total - efectivo;
    const asiento = await generarAsientoEnTx(c, "neura", q.empresaId, {
      origen_tipo: "pago_proveedor",
      origen_id: pagoId,
      evento_origen: "pago",
      fecha_contable: new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" }),
      glosa: `Pago a proveedor ${numero} · ${pr[0].nombre}`,
      lineas: [
        { cuenta_contable_id: cfg.cuenta_proveedores_id!, proveedor_id: pr[0].id, descripcion: `Pago ${numero}`, debe: total, haber: 0, documento_tipo: "pago_proveedor", documento_id: pagoId },
        ...(efectivo > 0 ? [{ cuenta_contable_id: cfg.cuenta_caja_id!, descripcion: `Pago ${numero} (efectivo)`, debe: 0, haber: efectivo, documento_tipo: "pago_proveedor", documento_id: pagoId }] : []),
        ...(banco > 0 ? [{ cuenta_contable_id: cfg.cuenta_banco_id!, descripcion: `Pago ${numero}`, debe: 0, haber: banco, documento_tipo: "pago_proveedor", documento_id: pagoId }] : []),
      ],
      createdBy: q.usuarioId,
    });
    await c.query(`UPDATE neura.pagos_proveedores SET asiento_contable_id = $2::uuid WHERE id = $1::uuid`, [pagoId, asiento.id]);
    return { id: pagoId, numero, total, asiento: asiento.numero };
  });
}

/** Anula el pago: lo aplicado vuelve a deberse y se genera el asiento inverso. */
export async function anularPago(pool: Pool, q: Quien, id: string, motivo: string) {
  await exigirPagos(pool);
  if (!motivo.trim()) throw new ErrorV2("Escribí el motivo de la anulación");
  return enTransaccion(pool, async (c) => {
    const { rows } = await c.query(`SELECT * FROM neura.pagos_proveedores WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`, [id, q.empresaId]);
    const p = rows[0];
    if (!p) throw new ErrorV2("Pago no encontrado", 404);
    if (p.estado === "anulado") throw new ErrorV2(`El pago ${p.numero} ya está anulado`);
    let reversion: string | null = null;
    if (p.asiento_contable_id) {
      const { rows: det } = await c.query(
        `SELECT cuenta_contable_id, proveedor_id, descripcion, debe::float AS debe, haber::float AS haber FROM neura.asientos_contables_detalles WHERE asiento_id = $1::uuid`,
        [p.asiento_contable_id]
      );
      const r = await generarAsientoEnTx(c, "neura", q.empresaId, {
        origen_tipo: "reversion",
        origen_id: p.id,
        evento_origen: "anulacion_pago_proveedor",
        fecha_contable: new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" }),
        glosa: `Anulación del pago ${p.numero}: ${motivo.trim().slice(0, 200)}`,
        asiento_original_id: p.asiento_contable_id,
        lineas: det.map((d) => ({ cuenta_contable_id: d.cuenta_contable_id, proveedor_id: d.proveedor_id, descripcion: d.descripcion, debe: d.haber, haber: d.debe, documento_tipo: "pago_proveedor", documento_id: p.id })),
        createdBy: q.usuarioId,
      });
      reversion = r.id;
    }
    await c.query(
      `UPDATE neura.pagos_proveedores SET estado = 'anulado', anulado_por = $2::uuid, anulado_por_nombre = $3, anulado_at = now(),
              anulado_motivo = $4, asiento_anulacion_id = $5::uuid WHERE id = $1::uuid`,
      [p.id, q.usuarioId, q.nombre, motivo.trim().slice(0, 500), reversion]
    );
    return { id: p.id, numero: p.numero, estado: "anulado" };
  });
}
