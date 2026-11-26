/**
 * Caja del ERP 2.0 sobre Neura.
 *
 *  · Cajas (`caja_puntos`): cada una vende desde un depósito. Neura no tiene sucursales: va una
 *    sola, "Casa central", con todas las cajas.
 *  · Turnos (`caja_turnos`): abrir → vender / retirar / ingresar → arqueo → cerrar.
 *  · Movimientos (`caja_movimientos`): cobros de ventas, retiros e ingresos de efectivo.
 *
 * VENTA: la mercadería sale del depósito de la caja (`inv_mover`, origen "venta"). Si va con
 * factura, se crea una FACTURA NORMAL de Neura (mismo correlativo, `factura_items` por producto)
 * que se emite a SIFEN desde Facturas como siempre; si es al contado, el cobro queda en `pagos`
 * igual que "Registrar pago". A crédito, la factura queda pendiente → cuentas por cobrar.
 * Sin factura ("ticket") solo al contado: no hay documento fiscal ni deuda que seguir.
 *
 * ANULAR: con las mismas reglas que Facturas (`evaluarAnulacionFactura`). Los cobros que creó la
 * propia venta se deshacen con ella; cualquier otro cobro, o un DE enviado/aprobado, lo impide.
 */
import type { Pool, PoolClient } from "pg";
import { evaluarAnulacionFactura } from "@/lib/facturacion/anulacion-rules";
import { montosFacturaItemGsPrecioIncluyeIva, type TasaIvaItem } from "@/lib/facturacion/factura-item-montos";
import { enTransaccion, ErrorV2, esUuid } from "./server";

export interface UsrCaja {
  empresaId: string;
  usuarioId: string;
  nombre: string;
  authUserId: string | null;
  esAdmin: boolean;
}

type Q = Pool | PoolClient;
const n = (v: unknown) => Number(v) || 0;
const HOY_PY = `(now() AT TIME ZONE 'America/Asuncion')::date`;

const ETIQUETA: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta_debito: "Tarjeta de débito",
  tarjeta_credito: "Tarjeta de crédito",
  transferencia: "Transferencia",
  qr: "QR / billetera",
  cheque: "Cheque",
  otro: "Otro",
};
const MEDIOS = Object.keys(ETIQUETA);
/** Medio del POS → `pagos.metodo_pago` de Neura (efectivo / transferencia / cheque / tarjeta / otro). */
const METODO_PAGO_NEURA: Record<string, string> = {
  efectivo: "efectivo",
  transferencia: "transferencia",
  cheque: "cheque",
  tarjeta_debito: "tarjeta",
  tarjeta_credito: "tarjeta",
  qr: "otro",
  otro: "otro",
};
/** El POS manda también los alias viejos del 2.0. */
function medio(v: unknown): string {
  const m = String(v ?? "").trim().toLowerCase();
  if (m === "pos_debito" || m === "tarjeta") return "tarjeta_debito";
  if (m === "pos_credito" || m === "pos") return "tarjeta_credito";
  if (m === "billetera") return "qr";
  return MEDIOS.includes(m) ? m : "";
}

async function siguienteNumero(c: PoolClient, empresaId: string, prefijo: string, tabla: "ventas" | "caja_movimientos") {
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`caja_num:${empresaId}:${prefijo}`]);
  const col = tabla === "ventas" ? "numero_control" : "numero";
  const { rows } = await c.query(
    `SELECT max(substring(${col} from '[0-9]+$')::bigint) AS m FROM neura.${tabla} WHERE empresa_id = $1::uuid AND ${col} LIKE $2`,
    [empresaId, `${prefijo}-%`]
  );
  return `${prefijo}-${String(n(rows[0]?.m) + 1).padStart(6, "0")}`;
}

// ── Estado de las cajas ──────────────────────────────────────────────────────

/** Efectivo que debería haber en el turno: apertura + ingresos − retiros/egresos (sin anulados). */
const SQL_EFECTIVO = `
  t.monto_apertura + COALESCE((SELECT sum(CASE WHEN m.tipo = 'ingreso' THEN m.monto WHEN m.tipo = 'ajuste' THEN 0 ELSE -m.monto END)
                                 FROM neura.caja_movimientos m
                                WHERE m.turno_id = t.id AND m.medio_pago = 'efectivo' AND m.anulado_at IS NULL), 0)`;

export async function estadoCajas(pool: Pool, u: UsrCaja) {
  const [deps, puntos, abiertas, recientes] = await Promise.all([
    pool.query(
      `SELECT id, nombre, COALESCE(es_predeterminado, false) AS es_principal, COALESCE(activo, true) AS activo
         FROM neura.inventario_ubicaciones WHERE empresa_id = $1::uuid ORDER BY es_predeterminado DESC NULLS LAST, nombre`,
      [u.empresaId]
    ),
    pool.query(
      `SELECT p.id, p.nombre, p.activo, p.ubicacion_id AS deposito_id, d.nombre AS deposito_nombre,
              (SELECT json_build_object('id', t.id, 'numero_caja', t.numero_caja, 'deposito_id', p.ubicacion_id,
                        'abierta_por', t.abierta_por, 'abierta_por_nombre', t.abierta_por_nombre,
                        'fecha_apertura', t.fecha_apertura, 'monto_apertura', t.monto_apertura::float8,
                        'observacion_apertura', t.observacion_apertura,
                        'efectivo_esperado', (${SQL_EFECTIVO})::float8,
                        'ventas_cantidad', (SELECT count(*) FROM neura.ventas v WHERE v.caja_turno_id = t.id AND v.estado <> 'anulada'),
                        'ventas_total', (SELECT COALESCE(sum(v.total), 0)::float8 FROM neura.ventas v WHERE v.caja_turno_id = t.id AND v.estado <> 'anulada'))
                 FROM neura.caja_turnos t WHERE t.punto_venta_id = p.id AND t.estado = 'abierta') AS turno,
              (SELECT json_build_object('id', t.id, 'numero_caja', t.numero_caja, 'fecha_cierre', t.fecha_cierre,
                        'diferencia', t.diferencia::float8, 'diferencia_otros', t.diferencia_otros::float8,
                        'cerrada_por_nombre', t.cerrada_por_nombre)
                 FROM neura.caja_turnos t WHERE t.punto_venta_id = p.id AND t.estado = 'cerrada'
                ORDER BY t.fecha_cierre DESC LIMIT 1) AS ultimo_cierre
         FROM neura.caja_puntos p JOIN neura.inventario_ubicaciones d ON d.id = p.ubicacion_id
        WHERE p.empresa_id = $1::uuid
        ORDER BY p.activo DESC, lower(p.nombre)`,
      [u.empresaId]
    ),
    pool.query(
      `SELECT t.id, t.numero_caja, p.id AS punto_venta_id, p.nombre AS punto_nombre, $1::text AS sucursal_id,
              'Casa central' AS sucursal_nombre, p.ubicacion_id AS deposito_id, d.nombre AS deposito_nombre,
              t.abierta_por_nombre, t.fecha_apertura, (t.abierta_por = $2::uuid) AS mia
         FROM neura.caja_turnos t
         JOIN neura.caja_puntos p ON p.id = t.punto_venta_id
         JOIN neura.inventario_ubicaciones d ON d.id = p.ubicacion_id
        WHERE t.empresa_id = $1::uuid AND t.estado = 'abierta'
        ORDER BY t.fecha_apertura`,
      [u.empresaId, u.usuarioId]
    ),
    pool.query(
      `SELECT t.id, t.numero_caja, t.fecha_apertura, t.fecha_cierre, t.monto_apertura::float8 AS monto_apertura,
              t.diferencia::float8 AS diferencia, t.diferencia_otros::float8 AS diferencia_otros, p.nombre AS punto_nombre,
              'Casa central' AS sucursal_nombre, t.cerrada_por_nombre, t.abierta_por_nombre,
              (SELECT COALESCE(sum(v.total), 0)::float8 FROM neura.ventas v WHERE v.caja_turno_id = t.id AND v.estado <> 'anulada') AS total_vendido
         FROM neura.caja_turnos t JOIN neura.caja_puntos p ON p.id = t.punto_venta_id
        WHERE t.empresa_id = $1::uuid AND t.estado = 'cerrada'
        ORDER BY t.fecha_cierre DESC LIMIT 30`,
      [u.empresaId]
    ),
  ]);
  const ab = abiertas.rows;
  const mias = ab.filter((a) => a.mia);
  const predeterminada = mias.length === 1 ? mias[0].id : ab.length === 1 ? ab[0].id : null;
  return {
    es_admin: u.esAdmin,
    mi_usuario_id: u.usuarioId,
    mi_sucursal_id: u.empresaId,
    predeterminada,
    predeterminada_error: ab.length > 1 && !predeterminada ? "Hay varias cajas abiertas: elegí en cuál vendés." : null,
    sucursales: [
      { id: u.empresaId, nombre: "Casa central", es_principal: true, activa: true, depositos: deps.rows, cajas: puntos.rows },
    ],
    abiertas: ab,
    recientes: recientes.rows,
  };
}

/** Alta o edición de una caja (nombre, depósito, activa). */
export async function guardarPunto(pool: Pool, u: UsrCaja, b: Record<string, unknown>) {
  if (!u.esAdmin) throw new ErrorV2("Solo un administrador configura las cajas.", 403);
  const nombre = String(b.nombre ?? "").trim().slice(0, 60);
  if (!nombre) throw new ErrorV2("Escribí el nombre de la caja");
  const activo = b.activo !== false;
  return enTransaccion(pool, async (c) => {
    let dep = esUuid(b.deposito_id) ? String(b.deposito_id) : null;
    if (!dep) {
      const { rows } = await c.query(`SELECT neura.inv_deposito_predeterminado($1::uuid) AS id`, [u.empresaId]);
      dep = rows[0]?.id ?? null;
    }
    if (!dep) throw new ErrorV2("Creá primero un depósito en Inventario › Depósitos.");
    const { rows: d } = await c.query(`SELECT 1 FROM neura.inventario_ubicaciones WHERE id = $1::uuid AND empresa_id = $2::uuid`, [dep, u.empresaId]);
    if (!d[0]) throw new ErrorV2("Depósito no encontrado");
    const { rows: rep } = await c.query(
      `SELECT 1 FROM neura.caja_puntos WHERE empresa_id = $1::uuid AND lower(nombre) = lower($2) AND id IS DISTINCT FROM $3::uuid`,
      [u.empresaId, nombre, esUuid(b.id) ? b.id : null]
    );
    if (rep[0]) throw new ErrorV2("Ya hay una caja con ese nombre.");
    if (esUuid(b.id)) {
      const { rows: t } = await c.query(`SELECT ubicacion_id, (SELECT count(*) FROM neura.caja_turnos WHERE punto_venta_id = p.id AND estado = 'abierta')::int AS abiertas FROM neura.caja_puntos p WHERE id = $1::uuid AND empresa_id = $2::uuid`, [b.id, u.empresaId]);
      if (!t[0]) throw new ErrorV2("Caja no encontrada", 404);
      if (t[0].abiertas && (!activo || t[0].ubicacion_id !== dep)) {
        throw new ErrorV2("La caja tiene un turno abierto: cerralo antes de desactivarla o cambiarle el depósito.");
      }
      await c.query(`UPDATE neura.caja_puntos SET nombre = $3, ubicacion_id = $4::uuid, activo = $5, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`, [b.id, u.empresaId, nombre, dep, activo]);
      return { id: b.id };
    }
    const { rows } = await c.query(
      `INSERT INTO neura.caja_puntos (empresa_id, nombre, ubicacion_id, activo) VALUES ($1::uuid, $2, $3::uuid, $4) RETURNING id`,
      [u.empresaId, nombre, dep, activo]
    );
    return { id: rows[0].id };
  });
}

export async function abrirTurno(pool: Pool, u: UsrCaja, puntoId: string, monto: number, observacion: string | null) {
  if (!esUuid(puntoId)) throw new ErrorV2("Elegí la caja que vas a abrir");
  if (!(monto >= 0)) throw new ErrorV2("El monto inicial tiene que ser 0 o más");
  return enTransaccion(pool, async (c) => {
    const { rows: p } = await c.query(`SELECT id, nombre, activo FROM neura.caja_puntos WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`, [puntoId, u.empresaId]);
    if (!p[0]) throw new ErrorV2("Caja no encontrada", 404);
    if (!p[0].activo) throw new ErrorV2("Esa caja está desactivada.");
    const { rows: ya } = await c.query(`SELECT numero_caja FROM neura.caja_turnos WHERE punto_venta_id = $1::uuid AND estado = 'abierta'`, [puntoId]);
    if (ya[0]) throw new ErrorV2(`${p[0].nombre} ya tiene un turno abierto (N° ${ya[0].numero_caja}).`);
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`caja_turno:${u.empresaId}`]);
    const { rows: m } = await c.query(`SELECT COALESCE(max(numero_caja), 0) + 1 AS n FROM neura.caja_turnos WHERE empresa_id = $1::uuid`, [u.empresaId]);
    const { rows } = await c.query(
      `INSERT INTO neura.caja_turnos (empresa_id, punto_venta_id, numero_caja, abierta_por, abierta_por_nombre, monto_apertura, observacion_apertura)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7) RETURNING id, numero_caja`,
      [u.empresaId, puntoId, m[0].n, u.usuarioId, u.nombre, monto, observacion?.trim().slice(0, 500) || null]
    );
    return { caja_id: rows[0].id, numero_caja: rows[0].numero_caja };
  });
}

async function turnoAbierto(c: Q, empresaId: string, id: unknown) {
  if (!esUuid(id)) throw new ErrorV2("Elegí la caja (abrí un turno primero).");
  const { rows } = await c.query(
    `SELECT t.id, t.numero_caja, t.estado, t.monto_apertura, p.ubicacion_id, p.nombre AS punto_nombre
       FROM neura.caja_turnos t JOIN neura.caja_puntos p ON p.id = t.punto_venta_id
      WHERE t.id = $1::uuid AND t.empresa_id = $2::uuid`,
    [id, empresaId]
  );
  if (!rows[0]) throw new ErrorV2("Caja no encontrada", 404);
  if (rows[0].estado !== "abierta") throw new ErrorV2("Ese turno de caja ya está cerrado: abrí uno nuevo.");
  return rows[0] as { id: string; numero_caja: number; ubicacion_id: string; punto_nombre: string; monto_apertura: string };
}

async function efectivoTurno(c: Q, turnoId: string) {
  const { rows } = await c.query(`SELECT (${SQL_EFECTIVO})::float8 AS e FROM neura.caja_turnos t WHERE t.id = $1::uuid`, [turnoId]);
  return n(rows[0]?.e);
}

// ── Resumen y cierre del turno ──────────────────────────────────────────────

export async function resumenTurno(pool: Pool, u: UsrCaja, id: string) {
  if (!esUuid(id)) throw new ErrorV2("Turno no encontrado", 404);
  const { rows: tr } = await pool.query(
    `SELECT t.*, p.nombre AS punto_nombre, p.ubicacion_id AS deposito_id, d.nombre AS deposito_nombre
       FROM neura.caja_turnos t
       JOIN neura.caja_puntos p ON p.id = t.punto_venta_id
       JOIN neura.inventario_ubicaciones d ON d.id = p.ubicacion_id
      WHERE t.id = $1::uuid AND t.empresa_id = $2::uuid`,
    [id, u.empresaId]
  );
  const t = tr[0];
  if (!t) throw new ErrorV2("Turno no encontrado", 404);
  const [movs, ventas, credito] = await Promise.all([
    pool.query(
      `SELECT m.*, v.numero_control FROM neura.caja_movimientos m LEFT JOIN neura.ventas v ON v.id = m.venta_id
        WHERE m.turno_id = $1::uuid ORDER BY m.created_at`,
      [id]
    ),
    pool.query(
      `SELECT v.id, v.numero_control, v.fecha, v.total::float8 AS total, v.tipo_venta, v.estado, v.metodo_pago, v.anulada_at,
              COALESCE(NULLIF(c.razon_social, ''), NULLIF(c.empresa, ''), c.nombre) AS cliente_nombre
         FROM neura.ventas v LEFT JOIN neura.clientes c ON c.id = v.cliente_id
        WHERE v.caja_turno_id = $1::uuid ORDER BY v.fecha`,
      [id]
    ),
    pool.query(
      `SELECT v.id AS venta_id, v.numero_control, v.fecha, v.estado, v.cliente_id,
              COALESCE(NULLIF(c.razon_social, ''), NULLIF(c.empresa, ''), c.nombre) AS cliente_nombre,
              COALESCE(NULLIF(c.ruc_factura, ''), c.ruc) AS cliente_ruc, v.total::float8 AS total, v.plazo_dias,
              f.fecha_vencimiento AS vencimiento, (f.monto - f.saldo)::float8 AS cobrado, f.saldo::float8 AS saldo, f.estado AS estado_cuenta
         FROM neura.ventas v
         LEFT JOIN neura.clientes c ON c.id = v.cliente_id
         LEFT JOIN neura.facturas f ON f.id = v.factura_id
        WHERE v.caja_turno_id = $1::uuid AND v.tipo_venta = 'CREDITO' AND v.estado <> 'anulada'
        ORDER BY v.fecha`,
      [id]
    ),
  ]);
  const vivos = movs.rows.filter((m) => !m.anulado_at);
  const signo = (m: { tipo: string }) => (m.tipo === "ingreso" ? 1 : m.tipo === "ajuste" ? 0 : -1);
  const suma = (f: (m: Record<string, unknown> & { tipo: string; monto: string }) => boolean) =>
    vivos.filter(f).reduce((s, m) => s + n(m.monto), 0);
  const cant = (f: (m: Record<string, unknown> & { tipo: string; monto: string }) => boolean) => {
    const l = vivos.filter(f);
    return { cantidad: l.length, total: l.reduce((s, m) => s + n(m.monto), 0) };
  };
  const declarado = (t.declarado ?? {}) as Record<string, number>;
  const usados = [...new Set(["efectivo", ...vivos.map((m) => m.medio_pago as string)])];
  const metodos = usados.map((metodo) => {
    const ingresos = suma((m) => m.medio_pago === metodo && m.tipo === "ingreso");
    const egresos = suma((m) => m.medio_pago === metodo && (m.tipo === "retiro" || m.tipo === "egreso"));
    const esperado = (metodo === "efectivo" ? n(t.monto_apertura) : 0) + ingresos - egresos;
    const dec = declarado[metodo] ?? (metodo === "efectivo" && t.monto_cierre_contado != null ? n(t.monto_cierre_contado) : null);
    return { metodo, label: ETIQUETA[metodo] ?? metodo, ingresos, egresos, esperado, declarado: dec, diferencia: dec == null ? null : dec - esperado };
  });
  const ef = (f: (m: Record<string, unknown> & { tipo: string; monto: string }) => boolean) =>
    suma((m) => m.medio_pago === "efectivo" && f(m));
  const efectivo = {
    apertura: n(t.monto_apertura),
    ventas: ef((m) => m.origen === "venta" && m.tipo === "ingreso"),
    cobros: ef((m) => m.origen === "cobro"),
    ingresos: ef((m) => m.origen === "manual" && m.tipo === "ingreso"),
    retiros: ef((m) => m.tipo === "retiro"),
    compras: ef((m) => m.origen === "compra"),
    gastos: ef((m) => m.origen === "gasto"),
    pagos_proveedores: ef((m) => m.origen === "pago_proveedor"),
    devoluciones: ef((m) => m.origen === "devolucion"),
    egresos_manuales: ef((m) => m.origen === "manual" && m.tipo === "egreso"),
    ajustes: ef((m) => m.tipo === "ajuste"),
    esperado: metodos.find((m) => m.metodo === "efectivo")!.esperado,
    contado: t.monto_cierre_contado == null ? null : n(t.monto_cierre_contado),
    diferencia: t.diferencia == null ? null : n(t.diferencia),
  };
  const vOk = ventas.rows.filter((v) => v.estado !== "anulada");
  const tot = (l: { total: number }[]) => ({ cantidad: l.length, total: l.reduce((s, v) => s + n(v.total), 0) });
  const porMetodo = (origen: string) =>
    usados
      .map((metodo) => {
        const l = vivos.filter((m) => m.origen === origen && m.medio_pago === metodo && m.tipo === "ingreso");
        return { metodo, label: ETIQUETA[metodo] ?? metodo, cantidad: l.length, total: l.reduce((s, m) => s + n(m.monto), 0) };
      })
      .filter((x) => x.cantidad);
  return {
    caja: {
      id: t.id, numero_caja: t.numero_caja, estado: t.estado, punto_venta_id: t.punto_venta_id, punto_nombre: t.punto_nombre,
      sucursal_id: u.empresaId, sucursal_nombre: "Casa central", deposito_id: t.deposito_id, deposito_nombre: t.deposito_nombre,
      abierta_por: t.abierta_por, abierta_por_nombre: t.abierta_por_nombre, cerrada_por_nombre: t.cerrada_por_nombre,
      fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre, monto_apertura: n(t.monto_apertura),
      observacion_apertura: t.observacion_apertura, observacion_cierre: t.observacion_cierre, motivo_diferencia: t.motivo_diferencia,
      monto_cierre_contado: t.monto_cierre_contado == null ? null : n(t.monto_cierre_contado),
      diferencia: t.diferencia == null ? null : n(t.diferencia), diferencia_otros: t.diferencia_otros == null ? null : n(t.diferencia_otros),
      billetes: t.billetes ?? null,
    },
    metodos,
    efectivo,
    ventas: {
      contado: tot(vOk.filter((v) => v.tipo_venta === "CONTADO")),
      credito: tot(vOk.filter((v) => v.tipo_venta === "CREDITO")),
      anuladas: tot(ventas.rows.filter((v) => v.estado === "anulada")),
      total: tot(vOk).total,
      cantidad: vOk.length,
      por_metodo: porMetodo("venta"),
    },
    cobros: { cantidad: 0, total: 0, por_metodo: porMetodo("cobro") },
    egresos: {
      compras: cant((m) => m.origen === "compra"), gastos: cant((m) => m.origen === "gasto"),
      pagos_proveedores: cant((m) => m.origen === "pago_proveedor"), devoluciones: cant((m) => m.origen === "devolucion"),
      total: suma((m) => ["compra", "gasto", "pago_proveedor", "devolucion"].includes(m.origen as string)),
    },
    manuales: {
      ingresos: cant((m) => m.origen === "manual" && m.tipo === "ingreso"),
      retiros: cant((m) => m.origen === "manual" && m.tipo === "retiro"),
      egresos: cant((m) => m.origen === "manual" && m.tipo === "egreso"),
      ajustes: cant((m) => m.tipo === "ajuste"),
    },
    credito: { cantidad: credito.rows.length, total: credito.rows.reduce((s, v) => s + n(v.total), 0), ventas: credito.rows.map((v) => ({ ...v, cuotas: 1, cuotas_cada: null })) },
    ventas_lista: ventas.rows.map((v) => ({
      ...v,
      pagos: movs.rows
        .filter((m) => m.venta_id === v.id && m.origen === "venta")
        .map((m) => ({ metodo: m.medio_pago, label: ETIQUETA[m.medio_pago] ?? m.medio_pago, monto: n(m.monto), referencia: m.referencia, vuelto: n(m.vuelto) })),
    })),
    movimientos: movs.rows.map((m) => ({
      id: m.id, tipo: m.tipo, origen: m.origen, concepto: m.concepto, monto: n(m.monto), signo: signo(m),
      metodo: m.medio_pago, metodo_label: ETIQUETA[m.medio_pago] ?? m.medio_pago, referencia: m.referencia, banco: m.banco,
      categoria: m.motivo, numero: m.numero ?? m.numero_control ?? null, observacion: m.observacion,
      documento: m.numero_control ?? null, venta_id: m.venta_id, cobro_id: null, compra_id: null, gasto_id: null,
      pago_proveedor_id: null, usuario_nombre: m.usuario_nombre, created_at: m.created_at,
      anulado: !!m.anulado_at, anulado_motivo: m.anulado_motivo,
    })),
  };
}

export async function cerrarTurno(pool: Pool, u: UsrCaja, b: Record<string, unknown>) {
  const contado = Number(b.monto_cierre_contado);
  if (!(contado >= 0)) throw new ErrorV2("Escribí cuánto efectivo contaste");
  return enTransaccion(pool, async (c) => {
    const t = await turnoAbierto(c, u.empresaId, b.caja_id);
    await c.query(`SELECT 1 FROM neura.caja_turnos WHERE id = $1::uuid FOR UPDATE`, [t.id]);
    const esperado = await efectivoTurno(c, t.id);
    const diferencia = contado - esperado;
    const declaradoIn = (b.declarado && typeof b.declarado === "object" ? b.declarado : {}) as Record<string, unknown>;
    const declarado: Record<string, number> = { efectivo: contado };
    let difOtros = 0;
    const { rows: otros } = await c.query(
      `SELECT medio_pago, sum(CASE WHEN tipo = 'ingreso' THEN monto WHEN tipo = 'ajuste' THEN 0 ELSE -monto END)::float8 AS esperado
         FROM neura.caja_movimientos WHERE turno_id = $1::uuid AND anulado_at IS NULL AND medio_pago <> 'efectivo' GROUP BY 1`,
      [t.id]
    );
    for (const o of otros) {
      const d = Number(declaradoIn[o.medio_pago]);
      if (Number.isFinite(d) && d >= 0) {
        declarado[o.medio_pago] = d;
        difOtros += d - n(o.esperado);
      }
    }
    const motivo = String(b.motivo_diferencia ?? "").trim().slice(0, 500) || null;
    if (Math.abs(diferencia) >= 1 && !motivo) throw new ErrorV2("Hay diferencia en el efectivo: escribí el motivo.");
    await c.query(
      `UPDATE neura.caja_turnos
          SET estado = 'cerrada', fecha_cierre = now(), cerrada_por = $2::uuid, cerrada_por_nombre = $3,
              monto_cierre_contado = $4, monto_esperado_efectivo = $5, diferencia = $6, diferencia_otros = $7,
              declarado = $8::jsonb, billetes = $9::jsonb, motivo_diferencia = $10, observacion_cierre = $11, updated_at = now()
        WHERE id = $1::uuid`,
      [t.id, u.usuarioId, u.nombre, contado, esperado, diferencia, difOtros, JSON.stringify(declarado),
       b.billetes && typeof b.billetes === "object" ? JSON.stringify(b.billetes) : null, motivo,
       String(b.observacion ?? "").trim().slice(0, 500) || null]
    );
    return { caja_id: t.id, numero_caja: t.numero_caja, contado, esperado, diferencia, diferencia_otros: difOtros };
  });
}

// ── Retiros e ingresos de efectivo ──────────────────────────────────────────

export async function registrarMovimiento(pool: Pool, u: UsrCaja, b: Record<string, unknown>) {
  const tipo = b.tipo === "ingreso" ? "ingreso" : b.tipo === "retiro" ? "retiro" : null;
  if (!tipo) throw new ErrorV2("Tipo de movimiento inválido");
  const monto = Math.round(Number(b.monto));
  if (!(monto > 0)) throw new ErrorV2("El monto tiene que ser mayor a 0");
  const motivo = String(b.motivo ?? "").trim().slice(0, 60) || "otro";
  const detalle = String(b.detalle ?? "").trim().slice(0, 300) || null;
  return enTransaccion(pool, async (c) => {
    const t = await turnoAbierto(c, u.empresaId, b.caja_id);
    await c.query(`SELECT 1 FROM neura.caja_turnos WHERE id = $1::uuid FOR UPDATE`, [t.id]);
    if (tipo === "retiro") {
      const hay = await efectivoTurno(c, t.id);
      if (monto > hay) throw new ErrorV2(`No hay tanto efectivo en la caja: hay Gs. ${Math.round(hay).toLocaleString("es-PY")}.`);
    }
    const numero = await siguienteNumero(c, u.empresaId, tipo === "retiro" ? "RET" : "ING", "caja_movimientos");
    const concepto = tipo === "retiro" ? "Retiro de efectivo" : "Ingreso de efectivo";
    const { rows } = await c.query(
      `INSERT INTO neura.caja_movimientos (empresa_id, turno_id, tipo, origen, numero, concepto, motivo, monto, medio_pago, observacion, usuario_id, usuario_nombre)
       VALUES ($1::uuid, $2::uuid, $3, 'manual', $4, $5, $6, $7, 'efectivo', $8, $9::uuid, $10) RETURNING id`,
      [u.empresaId, t.id, tipo, numero, concepto, motivo, monto, detalle, u.usuarioId, u.nombre]
    );
    return { id: rows[0].id, numero };
  });
}

/** Solo retiros / ingresos manuales de un turno abierto (los cobros se anulan con su venta). */
export async function anularMovimiento(pool: Pool, u: UsrCaja, id: string, motivo: string) {
  if (!esUuid(id)) throw new ErrorV2("Movimiento no encontrado", 404);
  if (!motivo.trim()) throw new ErrorV2("Escribí el motivo de la anulación");
  return enTransaccion(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT m.id, m.origen, m.anulado_at, t.estado FROM neura.caja_movimientos m JOIN neura.caja_turnos t ON t.id = m.turno_id
        WHERE m.id = $1::uuid AND m.empresa_id = $2::uuid FOR UPDATE OF m`,
      [id, u.empresaId]
    );
    const m = rows[0];
    if (!m) throw new ErrorV2("Movimiento no encontrado", 404);
    if (m.anulado_at) return { id };
    if (m.origen !== "manual") throw new ErrorV2("Los cobros de una venta se anulan anulando la venta.");
    if (m.estado !== "abierta") throw new ErrorV2("El turno ya está cerrado.");
    await c.query(
      `UPDATE neura.caja_movimientos SET anulado_at = now(), anulado_por = $2::uuid, anulado_motivo = $3 WHERE id = $1::uuid`,
      [id, u.usuarioId, motivo.trim().slice(0, 500)]
    );
    return { id };
  });
}

// ── Venta ────────────────────────────────────────────────────────────────────

export interface ItemVenta {
  producto_id: string;
  cantidad: number;
  tipo_precio?: string;
  tipo_iva?: string;
  precio_unitario?: number;
  descuento_pct?: number;
}
export interface PagoVenta {
  metodo_pago: string;
  monto: number;
  recibido?: number | null;
  referencia?: string | null;
  banco?: string | null;
}
export interface VentaInput {
  caja_id?: string | null;
  cliente_id?: string | null;
  cliente_ocasional?: boolean;
  tipo_venta?: string;
  tipo_documento?: string;
  idempotency_key?: string | null;
  descuento_pct?: number;
  plazo_dias?: number | null;
  cuotas?: number;
  observaciones?: string | null;
  items?: ItemVenta[];
  pagos?: PagoVenta[];
  plan_id?: string | null;
  entrega?: number | null;
  presupuesto_id?: string | null;
  mesa_cuenta_id?: string | null;
  pedido_id?: string | null;
}

const TASA: Record<string, TasaIvaItem> = { "10%": 10, "5%": 5, EXENTA: 0 };

export async function crearVenta(pool: Pool, u: UsrCaja, b: VentaInput) {
  const credito = b.tipo_venta === "CREDITO";
  const factura = b.tipo_documento === "factura";
  if (b.presupuesto_id || b.mesa_cuenta_id || b.pedido_id) throw new ErrorV2("Presupuestos, mesas y pedidos todavía no están en Neura.");
  if (credito && (b.plan_id || n(b.entrega) > 0)) throw new ErrorV2("Planes de cuotas y entrega inicial todavía no están en Neura: hacé la venta a crédito sin ellos.");
  if (credito && n(b.cuotas) > 1) throw new ErrorV2("En Neura la venta a crédito va en una sola cuota (vence a los días de plazo).");
  if (credito && !factura) throw new ErrorV2("La venta a crédito va con factura: así queda en cuentas por cobrar.");
  if (b.cliente_ocasional && (factura || credito)) throw new ErrorV2('El "Cliente ocasional" es solo para ventas al contado con ticket.');
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new ErrorV2("La venta debe tener al menos un producto");
  if (items.length > 300) throw new ErrorV2("Demasiados productos en una venta");
  const descGlobal = Math.min(100, Math.max(0, n(b.descuento_pct)));
  const plazo = credito ? Math.max(1, Math.round(n(b.plazo_dias) || 30)) : null;
  const key = typeof b.idempotency_key === "string" && b.idempotency_key.trim() ? b.idempotency_key.trim().slice(0, 120) : null;

  return enTransaccion(pool, async (c) => {
    if (key) {
      const { rows } = await c.query(
        `SELECT v.id, v.numero_control, v.total::float8 AS total, v.caja_turno_id, f.numero_factura, v.factura_id
           FROM neura.ventas v LEFT JOIN neura.facturas f ON f.id = v.factura_id
          WHERE v.empresa_id = $1::uuid AND v.idempotency_key = $2`,
        [u.empresaId, key]
      );
      if (rows[0]) {
        return { venta_id: rows[0].id, numero_control: rows[0].numero_control, total: rows[0].total, reusada: true, vuelto: 0, caja_id: rows[0].caja_turno_id, factura_id: rows[0].factura_id, numero_factura: rows[0].numero_factura };
      }
    }
    const t = await turnoAbierto(c, u.empresaId, b.caja_id);

    // Cliente
    let cliente: Record<string, unknown> | null = null;
    if (b.cliente_id) {
      if (!esUuid(b.cliente_id)) throw new ErrorV2("Cliente no encontrado");
      const { rows } = await c.query(
        `SELECT id, nombre, empresa, razon_social, nombre_contacto, ruc, ruc_factura, documento, deleted_at
           FROM neura.clientes WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [b.cliente_id, u.empresaId]
      );
      cliente = rows[0] ?? null;
      if (!cliente || cliente.deleted_at) throw new ErrorV2("Cliente no encontrado");
    }
    if ((factura || credito) && !cliente) throw new ErrorV2(factura ? "Para emitir factura elegí un cliente." : "La venta a crédito requiere un cliente.");
    if (factura && cliente) {
      const nombre = [cliente.razon_social, cliente.empresa, cliente.nombre_contacto, cliente.nombre].some((x) => String(x ?? "").trim());
      const doc = [cliente.ruc_factura, cliente.ruc, cliente.documento].some((x) => String(x ?? "").trim());
      if (!nombre || !doc) throw new ErrorV2("Al cliente le falta el nombre o el RUC / CI para la factura: completalo en Clientes.");
    }

    // Productos: precio del catálogo (o el editado en la línea) e IVA de la línea.
    const ids = [...new Set(items.map((i) => i.producto_id))];
    if (!ids.every(esUuid)) throw new ErrorV2("Producto inválido");
    const { rows: prods } = await c.query(
      `SELECT id, nombre, sku, COALESCE(precio_venta, 0)::float8 AS precio, COALESCE(costo_promedio, 0)::float8 AS costo, COALESCE(activo, true) AS activo
         FROM neura.productos WHERE empresa_id = $1::uuid AND id = ANY($2::uuid[])`,
      [u.empresaId, ids]
    );
    const porId = new Map(prods.map((p) => [p.id, p]));
    const lineas = items.map((i) => {
      const p = porId.get(i.producto_id);
      if (!p) throw new ErrorV2("Hay un producto que ya no existe: recargá la caja.");
      if (!p.activo) throw new ErrorV2(`"${p.nombre}" está desactivado.`);
      const cantidad = Number(i.cantidad);
      if (!(cantidad > 0) || cantidad > 1e6) throw new ErrorV2(`Cantidad inválida en "${p.nombre}"`);
      const tipoIva = i.tipo_iva && TASA[i.tipo_iva] !== undefined ? i.tipo_iva : "10%";
      const lista = n(i.precio_unitario) > 0 ? n(i.precio_unitario) : n(p.precio);
      if (!(lista > 0)) throw new ErrorV2(`"${p.nombre}" no tiene precio de venta: cargalo en Inventario o editá el precio en la línea.`);
      const dItem = Math.min(100, Math.max(0, n(i.descuento_pct)));
      const unit = Math.round(lista * (1 - dItem / 100) * (1 - descGlobal / 100));
      if (!(unit > 0)) throw new ErrorV2(`El descuento deja "${p.nombre}" en cero.`);
      const total = Math.round(unit * cantidad);
      const m = montosFacturaItemGsPrecioIncluyeIva(total, TASA[tipoIva]);
      return {
        producto_id: p.id as string, nombre: p.nombre as string, sku: (p.sku as string) ?? null, costo: n(p.costo),
        cantidad, tipo_iva: tipoIva, tasa: TASA[tipoIva], lista: n(p.precio), unit, descuento: dItem,
        tipo_precio: n(i.precio_unitario) > 0 ? "minorista" : (i.tipo_precio === "mayorista" || i.tipo_precio === "distribuidor" ? i.tipo_precio : "minorista"),
        subtotal: m.subtotal, iva: m.iva, total: m.total,
      };
    });
    const total = lineas.reduce((s, l) => s + l.total, 0);
    const subtotal = lineas.reduce((s, l) => s + l.subtotal, 0);
    const montoIva = lineas.reduce((s, l) => s + l.iva, 0);

    // Formas de pago (contado): tienen que sumar el total; el vuelto sale del efectivo recibido.
    let pagos: (PagoVenta & { medio: string; vuelto: number })[] = [];
    if (!credito) {
      const lista = Array.isArray(b.pagos) && b.pagos.length ? b.pagos : [{ metodo_pago: "efectivo", monto: total }];
      if (lista.length > 10) throw new ErrorV2("Demasiadas formas de pago");
      pagos = lista.map((p) => {
        const m = medio(p.metodo_pago);
        if (!m) throw new ErrorV2(p.metodo_pago === "saldo_favor" ? "El saldo a favor todavía no está en Neura." : "Forma de pago inválida");
        const monto = Math.round(n(p.monto));
        if (!(monto > 0)) throw new ErrorV2("Hay una forma de pago con monto en cero");
        const recibido = m === "efectivo" && n(p.recibido) > 0 ? Math.round(n(p.recibido)) : null;
        if (recibido != null && recibido < monto) throw new ErrorV2("Lo recibido en efectivo es menos que el monto.");
        return { ...p, medio: m, monto, recibido, vuelto: recibido != null ? recibido - monto : 0 };
      });
      const suma = pagos.reduce((s, p) => s + p.monto, 0);
      if (suma !== total) throw new ErrorV2(`Las formas de pago suman Gs. ${suma.toLocaleString("es-PY")} y la venta es de Gs. ${total.toLocaleString("es-PY")}.`);
    }

    // Venta
    const numero = await siguienteNumero(c, u.empresaId, "V", "ventas");
    const metodoVenta = credito ? "credito" : pagos.length > 1 ? "mixto" : pagos[0].medio;
    const { rows: vr } = await c.query(
      `INSERT INTO neura.ventas (empresa_id, cliente_id, numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, estado,
              tipo_venta, plazo_dias, fecha, observaciones, idempotency_key, vendedor_usuario_id, vendedor_nombre, pendiente_cobro,
              caja_turno_id, tipo_documento, metodo_pago, descuento_pct)
       VALUES ($1::uuid, $2::uuid, $3, 'GS', 1, $4, $5, $6, 'completada', $7, $8, now(), $9, $10, $11::uuid, $12, $13,
               $14::uuid, $15, $16, $17)
       RETURNING id`,
      [u.empresaId, cliente?.id ?? null, numero, subtotal, montoIva, total, credito ? "CREDITO" : "CONTADO", plazo,
       String(b.observaciones ?? "").trim().slice(0, 500) || null, key, u.usuarioId, u.nombre, credito,
       t.id, factura ? "factura" : "ticket", metodoVenta, descGlobal || null]
    );
    const ventaId = vr[0].id as string;
    for (const l of lineas) {
      await c.query(
        `INSERT INTO neura.ventas_items (empresa_id, venta_id, producto_id, producto_nombre, sku, cantidad, precio_venta_original,
                precio_venta, tipo_iva, subtotal, monto_iva, total_linea, descuento, costo_unitario, tipo_precio)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [u.empresaId, ventaId, l.producto_id, l.nombre, l.sku, l.cantidad, l.lista, l.unit, l.tipo_iva, l.subtotal, l.iva, l.total,
         l.descuento, l.costo, l.tipo_precio]
      );
    }
    // Stock del depósito de la caja, un movimiento por producto (si no alcanza, la base corta con el mensaje).
    const porProducto = new Map<string, { cantidad: number; costo: number }>();
    for (const l of lineas) {
      const a = porProducto.get(l.producto_id);
      porProducto.set(l.producto_id, { cantidad: (a?.cantidad ?? 0) + l.cantidad, costo: l.costo });
    }
    for (const [productoId, x] of porProducto) {
      await c.query(
        `SELECT neura.inv_mover($1::uuid, $2::uuid, $3::uuid, $4, $5, 'venta', 'venta', $6::uuid, $7, $8, $9::uuid, $10)`,
        [u.empresaId, productoId, t.ubicacion_id, -x.cantidad, x.costo, ventaId, numero, `Venta ${numero}`, u.usuarioId, u.nombre]
      );
    }

    // Factura de Neura (la de siempre: se emite a SIFEN desde Facturas).
    let facturaId: string | null = null;
    let numeroFactura: string | null = null;
    if (factura && cliente) {
      const { rows: nf } = await c.query(`SELECT neura.next_numero_factura_empresa($1::uuid, $2) AS n`, [u.empresaId, process.env.FACTURA_PREFIJO ?? "FAC-"]);
      numeroFactura = nf[0]?.n ?? null;
      if (!numeroFactura) throw new ErrorV2("No se pudo reservar el número de factura.");
      const { rows: fr } = await c.query(
        `INSERT INTO neura.facturas (empresa_id, cliente_id, numero_factura, fecha, fecha_vencimiento, monto, saldo, estado, tipo, moneda)
         VALUES ($1::uuid, $2::uuid, $3, ${HOY_PY}, ${HOY_PY} + $4::int, $5, $5, 'Pendiente', $6, 'GS') RETURNING id`,
        [u.empresaId, cliente.id, numeroFactura, plazo ?? 0, total, credito ? "credito" : "contado"]
      );
      facturaId = fr[0].id as string;
      for (const l of lineas) {
        await c.query(
          `INSERT INTO neura.factura_items (factura_id, empresa_id, descripcion, cantidad, precio_unitario, subtotal, iva, total, codigo)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)`,
          [facturaId, u.empresaId, l.nombre, l.cantidad, l.unit, l.subtotal, l.iva, l.total, l.sku]
        );
      }
      await c.query(`UPDATE neura.ventas SET factura_id = $2::uuid WHERE id = $1::uuid`, [ventaId, facturaId]);
    }

    // Cobro: en `pagos` (si hay factura, como "Registrar pago") y en la caja.
    let vuelto = 0;
    for (const p of pagos) {
      let pagoId: string | null = null;
      if (facturaId) {
        const { rows: pr } = await c.query(
          `INSERT INTO neura.pagos (empresa_id, factura_id, monto, fecha_pago, metodo_pago, referencia, cliente_id, usuario_id)
           VALUES ($1::uuid, $2::uuid, $3, ${HOY_PY}, $4, $5, $6::uuid, $7::uuid) RETURNING id`,
          [u.empresaId, facturaId, p.monto, METODO_PAGO_NEURA[p.medio], [p.medio === "qr" ? "QR" : null, p.referencia?.trim(), p.banco?.trim()].filter(Boolean).join(" · ") || null,
           cliente?.id ?? null, u.authUserId]
        );
        pagoId = pr[0].id;
      }
      vuelto += p.vuelto;
      await c.query(
        `INSERT INTO neura.caja_movimientos (empresa_id, turno_id, tipo, origen, concepto, monto, medio_pago, recibido, vuelto, referencia, banco,
                venta_id, factura_id, pago_id, usuario_id, usuario_nombre)
         VALUES ($1::uuid, $2::uuid, 'ingreso', 'venta', $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11::uuid, $12::uuid, $13::uuid, $14)`,
        [u.empresaId, t.id, `Venta ${numero}${numeroFactura ? ` · ${numeroFactura}` : ""}`, p.monto, p.medio, p.recibido ?? null, p.vuelto || null,
         p.referencia?.trim().slice(0, 120) || null, p.banco?.trim().slice(0, 80) || null, ventaId, facturaId, pagoId, u.usuarioId, u.nombre]
      );
    }
    if (facturaId && !credito) {
      await c.query(`UPDATE neura.facturas SET saldo = 0, estado = 'Pagado', updated_at = now() WHERE id = $1::uuid`, [facturaId]);
    }
    return { venta_id: ventaId, numero_control: numero, total, reusada: false, vuelto, caja_id: t.id, factura_id: facturaId, numero_factura: numeroFactura };
  });
}

// ── Listado, detalle y anulación ────────────────────────────────────────────

export interface FiltrosVentas {
  pagina: number;
  porPagina: number;
  q: string;
  tipo: string;
  iva: string;
  estado: string;
  punto: string;
  metodo: string;
  desde: string;
  hasta: string;
  contar: boolean;
}

export async function listarVentas(pool: Pool, empresaId: string, f: FiltrosVentas) {
  const where = ["v.empresa_id = $1::uuid", "v.caja_turno_id IS NOT NULL"];
  const args: unknown[] = [empresaId];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (f.q) {
    const a = arg(`%${f.q}%`);
    where.push(`(v.numero_control ILIKE ${a} OR fa.numero_factura ILIKE ${a} OR c.nombre ILIKE ${a} OR c.razon_social ILIKE ${a} OR c.ruc ILIKE ${a}
                 OR EXISTS (SELECT 1 FROM neura.ventas_items i WHERE i.venta_id = v.id AND (i.producto_nombre ILIKE ${a} OR i.sku ILIKE ${a})))`);
  }
  if (f.tipo === "CONTADO" || f.tipo === "CREDITO") where.push(`v.tipo_venta = ${arg(f.tipo)}`);
  if (["10%", "5%", "EXENTA"].includes(f.iva)) where.push(`EXISTS (SELECT 1 FROM neura.ventas_items i WHERE i.venta_id = v.id AND i.tipo_iva = ${arg(f.iva)})`);
  if (f.estado) where.push(`v.estado = ${arg(f.estado)}`);
  if (esUuid(f.punto)) where.push(`t.punto_venta_id = ${arg(f.punto)}::uuid`);
  if (f.metodo) where.push(`v.metodo_pago = ${arg(f.metodo)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.desde)) where.push(`(v.fecha AT TIME ZONE 'America/Asuncion')::date >= ${arg(f.desde)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) where.push(`(v.fecha AT TIME ZONE 'America/Asuncion')::date <= ${arg(f.hasta)}::date`);
  const desde = `FROM neura.ventas v
    JOIN neura.caja_turnos t ON t.id = v.caja_turno_id
    JOIN neura.caja_puntos p ON p.id = t.punto_venta_id
    LEFT JOIN neura.clientes c ON c.id = v.cliente_id
    LEFT JOIN neura.facturas fa ON fa.id = v.factura_id
    WHERE ${where.join(" AND ")}`;
  const lim = arg(f.porPagina);
  const off = arg((f.pagina - 1) * f.porPagina);
  const [rows, cuenta] = await Promise.all([
    pool.query(
      `SELECT v.id, v.numero_control, v.fecha, v.total::float8 AS total, v.tipo_venta, v.estado, v.metodo_pago,
              v.vendedor_nombre AS usuario_nombre, json_build_object('nombre', p.nombre) AS punto,
              json_build_object('nombre', 'Casa central') AS sucursal, fa.numero_factura,
              COALESCE((SELECT json_agg(json_build_object('producto_nombre', i.producto_nombre, 'sku', i.sku, 'cantidad', i.cantidad::float8, 'tipo_iva', i.tipo_iva))
                          FROM neura.ventas_items i WHERE i.venta_id = v.id), '[]') AS ventas_items,
              (SELECT json_agg(json_build_object('metodo_pago', m.medio_pago, 'monto', m.monto::float8))
                 FROM neura.caja_movimientos m WHERE m.venta_id = v.id AND m.origen = 'venta' AND m.tipo = 'ingreso') AS pagos
         ${desde} ORDER BY v.fecha DESC LIMIT ${lim} OFFSET ${off}`,
      args
    ),
    f.contar
      ? pool.query(
          `SELECT count(*)::int AS n, (SELECT count(*)::int FROM neura.ventas WHERE empresa_id = $1::uuid AND caja_turno_id IS NOT NULL) AS g
             ${desde}`,
          args.slice(0, args.length - 2)
        )
      : Promise.resolve(null),
  ]);
  return { rows: rows.rows, total: cuenta ? cuenta.rows[0].n : null, total_general: cuenta ? cuenta.rows[0].g : null };
}

export async function detalleVenta(pool: Pool, empresaId: string, id: string) {
  if (!esUuid(id)) throw new ErrorV2("Venta no encontrada", 404);
  const { rows } = await pool.query(
    `SELECT v.id, v.numero_control, v.fecha, v.subtotal::float8 AS subtotal, v.monto_iva::float8 AS monto_iva, v.total::float8 AS total,
            v.estado, v.tipo_venta, v.plazo_dias, 1 AS cuotas, NULL::text AS cuotas_cada, v.metodo_pago, v.vendedor_nombre AS usuario_nombre,
            v.anulada_at, v.anulada_motivo, fa.numero_factura AS fiscal_numero, NULL::text AS fiscal_timbrado, v.tipo_documento,
            v.factura_id, fa.estado AS factura_estado, fe.estado_sifen,
            json_build_object('numero_caja', t.numero_caja, 'estado', t.estado) AS turno,
            json_build_object('nombre', p.nombre) AS punto, json_build_object('nombre', 'Casa central') AS sucursal,
            json_build_object('nombre', d.nombre) AS deposito,
            COALESCE(NULLIF(c.razon_social, ''), NULLIF(c.empresa, ''), c.nombre) AS receptor_nombre,
            COALESCE(NULLIF(c.ruc_factura, ''), NULLIF(c.ruc, ''), c.documento) AS receptor_ruc,
            fa.fecha_vencimiento, (fa.monto - fa.saldo)::float8 AS cobrado, fa.saldo::float8 AS saldo
       FROM neura.ventas v
       LEFT JOIN neura.caja_turnos t ON t.id = v.caja_turno_id
       LEFT JOIN neura.caja_puntos p ON p.id = t.punto_venta_id
       LEFT JOIN neura.inventario_ubicaciones d ON d.id = p.ubicacion_id
       LEFT JOIN neura.clientes c ON c.id = v.cliente_id
       LEFT JOIN neura.facturas fa ON fa.id = v.factura_id
       LEFT JOIN neura.factura_electronica fe ON fe.factura_id = fa.id
      WHERE v.id = $1::uuid AND v.empresa_id = $2::uuid`,
    [id, empresaId]
  );
  const v = rows[0];
  if (!v) throw new ErrorV2("Venta no encontrada", 404);
  const [items, pagos] = await Promise.all([
    pool.query(
      `SELECT id, producto_nombre, sku, cantidad::float8 AS cantidad, precio_venta::float8 AS precio_venta, COALESCE(tipo_precio, 'minorista') AS tipo_precio,
              tipo_iva, monto_iva::float8 AS monto_iva, total_linea::float8 AS total_linea
         FROM neura.ventas_items WHERE venta_id = $1::uuid ORDER BY created_at, id`,
      [id]
    ),
    pool.query(
      `SELECT id, medio_pago AS metodo_pago, monto::float8 AS monto, referencia, banco, recibido::float8 AS recibido, vuelto::float8 AS vuelto
         FROM neura.caja_movimientos WHERE venta_id = $1::uuid AND origen = 'venta' AND tipo = 'ingreso' ORDER BY created_at`,
      [id]
    ),
  ]);
  const cuenta = v.tipo_venta === "CREDITO" && v.factura_id
    ? { vencimiento: v.fecha_vencimiento, cobrado: n(v.cobrado), saldo: n(v.saldo), estado: v.factura_estado }
    : null;
  return { venta: v, items: items.rows, pagos: pagos.rows, correcciones: [], cuenta, cliente_nombre: v.receptor_nombre ?? "Cliente ocasional" };
}

/**
 * Anula la venta: devuelve el stock, saca los cobros de la caja y, si tiene factura, la anula
 * con las reglas de Facturas (no anula si tiene otros cobros o un DE enviado / aprobado).
 * Turno abierto: los cobros quedan anulados en ese turno. Turno cerrado: la devolución sale como
 * egreso de la caja abierta que se elija (`cajaDevolucion`).
 */
export async function anularVenta(pool: Pool, u: UsrCaja, id: string, motivo: string, cajaDevolucion: string | null) {
  if (!esUuid(id)) throw new ErrorV2("Venta no encontrada", 404);
  if (!motivo.trim()) throw new ErrorV2("Escribí el motivo de la anulación");
  const motivoTxt = motivo.trim().slice(0, 500);
  return enTransaccion(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT v.*, t.estado AS turno_estado, p.ubicacion_id
         FROM neura.ventas v JOIN neura.caja_turnos t ON t.id = v.caja_turno_id JOIN neura.caja_puntos p ON p.id = t.punto_venta_id
        WHERE v.id = $1::uuid AND v.empresa_id = $2::uuid FOR UPDATE OF v`,
      [id, u.empresaId]
    );
    const v = rows[0];
    if (!v) throw new ErrorV2("Venta no encontrada", 404);
    if (v.estado === "anulada") return { id, ya_anulada: true };
    const { rows: movs } = await c.query(
      `SELECT id, monto, medio_pago, pago_id FROM neura.caja_movimientos WHERE venta_id = $1::uuid AND origen = 'venta' AND tipo = 'ingreso' AND anulado_at IS NULL`,
      [id]
    );

    if (v.factura_id) {
      const { rows: fr } = await c.query(
        `SELECT f.estado, f.numero_factura, fe.estado_sifen,
                (SELECT count(*)::int FROM neura.pagos pg WHERE pg.factura_id = f.id AND NOT (pg.id = ANY($2::uuid[]))) AS otros_pagos,
                (SELECT count(*)::int FROM neura.pagos pg WHERE pg.id = ANY($2::uuid[]) AND pg.estado_contable = 'contabilizado') AS contabilizados,
                (SELECT count(*)::int FROM neura.nota_credito nc WHERE nc.factura_id = f.id) AS notas
           FROM neura.facturas f LEFT JOIN neura.factura_electronica fe ON fe.factura_id = f.id
          WHERE f.id = $1::uuid FOR UPDATE OF f`,
        [v.factura_id, movs.map((m) => m.pago_id).filter(Boolean)]
      );
      const f = fr[0];
      if (f && f.estado !== "Anulado") {
        if (f.notas) throw new ErrorV2(`La factura ${f.numero_factura} tiene notas de crédito: gestionala desde Facturas.`);
        if (f.contabilizados) throw new ErrorV2(`Los cobros de la factura ${f.numero_factura} ya están contabilizados: anulala desde Facturas.`);
        const decision = evaluarAnulacionFactura({ estadoFactura: f.estado === "Pagado" && !f.otros_pagos ? "Pendiente" : f.estado, pagosCount: f.otros_pagos, estadoSifen: f.estado_sifen ?? null });
        if (!decision.puede_anular) throw new ErrorV2(`Factura ${f.numero_factura}: ${decision.motivo_bloqueo}`);
        await c.query(`DELETE FROM neura.pagos WHERE id = ANY($1::uuid[]) AND factura_id = $2::uuid`, [movs.map((m) => m.pago_id).filter(Boolean), v.factura_id]);
        await c.query(
          `UPDATE neura.facturas SET estado = 'Anulado', saldo = 0, anulado_at = now(), anulado_por = $2::uuid, anulacion_motivo = $3, updated_at = now()
            WHERE id = $1::uuid`,
          [v.factura_id, u.authUserId, `Venta ${v.numero_control} anulada en caja: ${motivoTxt}`]
        );
      }
    }

    // Stock de vuelta al depósito de la caja.
    const { rows: items } = await c.query(
      `SELECT producto_id, sum(cantidad) AS cantidad, max(costo_unitario) AS costo_unitario FROM neura.ventas_items
        WHERE venta_id = $1::uuid AND producto_id IS NOT NULL GROUP BY producto_id`,
      [id]
    );
    for (const it of items) {
      await c.query(
        `SELECT neura.inv_mover($1::uuid, $2::uuid, $3::uuid, $4, $5, 'anulacion_venta', 'venta_anulacion', $6::uuid, $7, $8, $9::uuid, $10)`,
        [u.empresaId, it.producto_id, v.ubicacion_id, n(it.cantidad), n(it.costo_unitario), id, v.numero_control, `Anulación venta ${v.numero_control}`, u.usuarioId, u.nombre]
      );
    }

    // Cobros: si el turno sigue abierto se anulan; si ya cerró, la devolución sale de una caja abierta.
    if (movs.length) {
      if (v.turno_estado === "abierta") {
        await c.query(
          `UPDATE neura.caja_movimientos SET anulado_at = now(), anulado_por = $2::uuid, anulado_motivo = $3, pago_id = NULL WHERE id = ANY($1::uuid[])`,
          [movs.map((m) => m.id), u.usuarioId, motivoTxt]
        );
      } else {
        const t = await turnoAbierto(c, u.empresaId, cajaDevolucion);
        const efectivo = movs.filter((m) => m.medio_pago === "efectivo").reduce((s, m) => s + n(m.monto), 0);
        if (efectivo > 0 && efectivo > (await efectivoTurno(c, t.id))) throw new ErrorV2("No hay efectivo suficiente en esa caja para la devolución.");
        for (const m of movs) {
          await c.query(
            `INSERT INTO neura.caja_movimientos (empresa_id, turno_id, tipo, origen, concepto, monto, medio_pago, venta_id, observacion, usuario_id, usuario_nombre)
             VALUES ($1::uuid, $2::uuid, 'egreso', 'devolucion', $3, $4, $5, $6::uuid, $7, $8::uuid, $9)`,
            [u.empresaId, t.id, `Devolución venta ${v.numero_control}`, m.monto, m.medio_pago, id, motivoTxt, u.usuarioId, u.nombre]
          );
        }
        await c.query(`UPDATE neura.caja_movimientos SET pago_id = NULL WHERE id = ANY($1::uuid[])`, [movs.map((m) => m.id)]);
      }
    }
    await c.query(
      `UPDATE neura.ventas SET estado = 'anulada', anulada_at = now(), anulada_por = $2::uuid, anulada_motivo = $3, pendiente_cobro = false, updated_at = now() WHERE id = $1::uuid`,
      [id, u.usuarioId, motivoTxt]
    );
    return { id };
  });
}

/** Usuario de caja a partir del contexto de /api/v2. */
export const usrCaja = (c: { empresaId: string; usuarioId: string; nombre: string; authUserId: string | null; esAdmin: boolean }): UsrCaja => ({
  empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre, authUserId: c.authUserId, esAdmin: c.esAdmin,
});

/** Totales del día (turnos abiertos hoy o todavía abiertos) para la pantalla de turnos. */
export async function totalesDia(pool: Pool, empresaId: string) {
  const { rows } = await pool.query(
    `WITH t AS (
       SELECT t.* FROM neura.caja_turnos t
        WHERE t.empresa_id = $1::uuid AND (t.estado = 'abierta' OR (t.fecha_apertura AT TIME ZONE 'America/Asuncion')::date = ${HOY_PY})
     ), v AS (
       SELECT v.* FROM neura.ventas v WHERE v.caja_turno_id IN (SELECT id FROM t) AND v.estado <> 'anulada'
     )
     SELECT ${HOY_PY}::text AS fecha,
            (SELECT count(*) FROM t)::int AS turnos, (SELECT count(*) FROM t WHERE estado = 'abierta')::int AS abiertos,
            (SELECT COALESCE(sum(total), 0) FROM v)::float8 AS total_vendido,
            (SELECT COALESCE(sum(total), 0) FROM v WHERE tipo_venta = 'CONTADO')::float8 AS ventas_contado,
            (SELECT COALESCE(sum(total), 0) FROM v WHERE tipo_venta = 'CREDITO')::float8 AS ventas_credito,
            (SELECT COALESCE(sum(${SQL_EFECTIVO}), 0) FROM t WHERE t.estado = 'abierta')::float8 AS efectivo_esperado,
            (SELECT COALESCE(sum(diferencia), 0) FROM t WHERE estado = 'cerrada')::float8 AS diferencia,
            (SELECT COALESCE(sum(v2.total), 0) FROM neura.ventas v2 WHERE v2.empresa_id = $1::uuid AND v2.caja_turno_id IS NOT NULL AND v2.estado <> 'anulada' AND (v2.fecha AT TIME ZONE 'America/Asuncion')::date = ${HOY_PY})::float8 AS hoy_total,
            (SELECT COALESCE(sum(v2.total), 0) FROM neura.ventas v2 WHERE v2.empresa_id = $1::uuid AND v2.caja_turno_id IS NOT NULL AND v2.estado <> 'anulada' AND v2.tipo_venta = 'CONTADO' AND (v2.fecha AT TIME ZONE 'America/Asuncion')::date = ${HOY_PY})::float8 AS hoy_contado,
            (SELECT COALESCE(sum(v2.total), 0) FROM neura.ventas v2 WHERE v2.empresa_id = $1::uuid AND v2.caja_turno_id IS NOT NULL AND v2.estado <> 'anulada' AND v2.tipo_venta = 'CREDITO' AND (v2.fecha AT TIME ZONE 'America/Asuncion')::date = ${HOY_PY})::float8 AS hoy_credito,
            (SELECT count(*) FROM neura.ventas v2 WHERE v2.empresa_id = $1::uuid AND v2.caja_turno_id IS NOT NULL AND v2.estado <> 'anulada' AND (v2.fecha AT TIME ZONE 'America/Asuncion')::date = ${HOY_PY})::int AS hoy_cantidad`,
    [empresaId]
  );
  const r = rows[0];
  return {
    fecha: r.fecha,
    totales: { turnos: r.turnos, abiertos: r.abiertos, total_vendido: r.total_vendido, ventas_contado: r.ventas_contado, ventas_credito: r.ventas_credito, cobros: 0, efectivo_esperado: r.efectivo_esperado, diferencia: r.diferencia },
    hoy: { total_vendido: r.hoy_total, ventas_contado: r.hoy_contado, ventas_credito: r.hoy_credito, cantidad_ventas: r.hoy_cantidad, cobros: 0 },
  };
}

/** Deuda del cliente (facturas pendientes de Neura) para el cobro a crédito. */
export async function estadoCuentaCliente(pool: Pool, empresaId: string, clienteId: string) {
  if (!esUuid(clienteId)) throw new ErrorV2("Cliente no encontrado", 404);
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(saldo), 0)::float8 AS deuda,
            COALESCE(sum(saldo) FILTER (WHERE fecha_vencimiento < ${HOY_PY}), 0)::float8 AS vencido
       FROM neura.facturas WHERE empresa_id = $1::uuid AND cliente_id = $2::uuid AND estado IN ('Pendiente', 'Vencido') AND saldo > 0`,
    [empresaId, clienteId]
  );
  return { cuentas: [], cobros: [], deuda: rows[0].deuda, vencido: rows[0].vencido, saldo_favor: 0 };
}
