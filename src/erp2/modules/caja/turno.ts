"use client";

/**
 * Caja por sucursal — cliente (receta 51_caja_sucursal.sql).
 *   · cajas (puntos de venta) por sucursal, cada una con su depósito de salida
 *   · cada apertura es un TURNO (abrir → vender / cobrar / retirar → arqueo → cerrar)
 *   · varias cajas abiertas a la vez; cada usuario trabaja en una de su sucursal
 * Una sola llamada (listar_cajas) trae el estado de todas las cajas que ve el usuario,
 * las abiertas que puede usar y la que le toca por defecto.
 */
import { useEffect, useState } from "react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { fechaHora as fechaHoraPY, hora as horaPY } from "@/erp2/lib/fecha/paraguay";
import { apiFetchSWR, guardadoAlInstante, invalidar } from "@/erp2/lib/api/cache-cliente";

export type TurnoEnCurso = {
  id: string;
  numero_caja: number;
  deposito_id: string;
  abierta_por: string | null;
  abierta_por_nombre: string | null;
  fecha_apertura: string;
  monto_apertura: number;
  observacion_apertura: string | null;
  efectivo_esperado: number;
  ventas_cantidad: number;
  ventas_total: number;
};

export type CajaPunto = {
  id: string;
  nombre: string;
  activo: boolean;
  deposito_id: string;
  deposito_nombre: string;
  turno: TurnoEnCurso | null;
  ultimo_cierre: {
    id: string;
    numero_caja: number;
    fecha_cierre: string | null;
    diferencia: number | null;
    diferencia_otros: number | null;
    cerrada_por_nombre: string | null;
  } | null;
};

export type SucursalCajas = {
  id: string;
  nombre: string;
  es_principal: boolean;
  activa: boolean;
  depositos: { id: string; nombre: string; es_principal: boolean; activo: boolean }[];
  cajas: CajaPunto[];
};

/** Turno abierto que el usuario puede usar (selector de caja). */
export type CajaAbierta = {
  id: string;
  numero_caja: number;
  punto_venta_id: string;
  punto_nombre: string;
  sucursal_id: string;
  sucursal_nombre: string;
  deposito_id: string;
  deposito_nombre: string;
  abierta_por_nombre: string | null;
  fecha_apertura: string;
  mia: boolean;
};

export type TurnoReciente = {
  id: string;
  numero_caja: number;
  fecha_apertura: string;
  fecha_cierre: string | null;
  monto_apertura: number;
  diferencia: number | null;
  diferencia_otros: number | null;
  punto_nombre: string;
  sucursal_nombre: string;
  cerrada_por_nombre: string | null;
  abierta_por_nombre: string | null;
  total_vendido: number;
};

export type EstadoCajas = {
  es_admin: boolean;
  mi_usuario_id: string;
  mi_sucursal_id: string | null;
  /** turno que se usa si el usuario no elige (null si no hay o hay que elegir) */
  predeterminada: string | null;
  predeterminada_error: string | null;
  sucursales: SucursalCajas[];
  abiertas: CajaAbierta[];
  recientes: TurnoReciente[];
};

export type MetodoArqueo = {
  metodo: string;
  label: string;
  ingresos: number;
  egresos: number;
  esperado: number;
  declarado: number | null;
  diferencia: number | null;
};

type CantTotal = { cantidad: number; total: number };
type PorMetodo = { metodo: string; label: string; cantidad: number; total: number };

export type MovimientoTurno = {
  id: string;
  tipo: string;
  origen: "venta" | "devolucion" | "cobro" | "compra" | "gasto" | "pago_proveedor" | "manual";
  concepto: string;
  monto: number;
  signo: number;
  metodo: string;
  metodo_label: string;
  referencia: string | null;
  banco: string | null;
  categoria: string | null;
  numero: string | null;
  observacion: string | null;
  documento: string | null;
  venta_id: string | null;
  cobro_id: string | null;
  compra_id: string | null;
  gasto_id: string | null;
  pago_proveedor_id: string | null;
  usuario_nombre: string | null;
  created_at: string;
  anulado: boolean;
  anulado_motivo: string | null;
};

export type VentaCreditoTurno = {
  venta_id: string;
  numero_control: string;
  fecha: string;
  estado: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  cliente_ruc: string | null;
  total: number;
  plazo_dias: number | null;
  vencimiento: string | null;
  cobrado: number | null;
  saldo: number | null;
  estado_cuenta: string | null;
  cuotas?: number | null;
  cuotas_cada?: string | null;
};

export type ResumenTurno = {
  caja: {
    id: string;
    numero_caja: number;
    estado: string;
    punto_venta_id: string;
    punto_nombre: string;
    sucursal_id: string;
    sucursal_nombre: string;
    deposito_id: string;
    deposito_nombre: string;
    abierta_por: string | null;
    abierta_por_nombre: string | null;
    cerrada_por_nombre: string | null;
    fecha_apertura: string;
    fecha_cierre: string | null;
    monto_apertura: number;
    observacion_apertura: string | null;
    observacion_cierre: string | null;
    motivo_diferencia: string | null;
    monto_cierre_contado: number | null;
    diferencia: number | null;
    diferencia_otros: number | null;
    billetes: Record<string, number> | null;
  };
  metodos: MetodoArqueo[];
  efectivo: {
    apertura: number;
    ventas: number;
    cobros: number;
    ingresos: number;
    retiros: number;
    compras: number;
    gastos: number;
    pagos_proveedores: number;
    devoluciones: number;
    egresos_manuales: number;
    ajustes: number;
    esperado: number;
    contado: number | null;
    diferencia: number | null;
  };
  ventas: { contado: CantTotal; credito: CantTotal; anuladas: CantTotal; total: number; cantidad: number; por_metodo: PorMetodo[] };
  cobros: { cantidad: number; total: number; por_metodo: PorMetodo[] };
  egresos: { compras: CantTotal; gastos: CantTotal; pagos_proveedores: CantTotal; devoluciones: CantTotal; total: number };
  manuales: { ingresos: CantTotal; retiros: CantTotal; egresos: CantTotal; ajustes: CantTotal };
  credito: { cantidad: number; total: number; ventas: VentaCreditoTurno[] };
  ventas_lista: {
    id: string;
    numero_control: string;
    fecha: string;
    total: number;
    tipo_venta: string;
    estado: string;
    metodo_pago: string | null;
    anulada_at: string | null;
    cliente_nombre: string | null;
    pagos: { metodo: string; label: string; monto: number; referencia: string | null; vuelto: number }[];
  }[];
  movimientos: MovimientoTurno[];
};

// ── Formas de pago de la venta ───────────────────────────────────────────────
export type MetodoVenta = "efectivo" | "tarjeta_debito" | "tarjeta_credito" | "transferencia" | "qr" | "cheque";

export const METODOS_VENTA: { value: MetodoVenta; label: string; corto: string; tecla: string; referencia?: string; banco?: boolean }[] = [
  { value: "efectivo", label: "Efectivo", corto: "Efectivo", tecla: "1" },
  { value: "tarjeta_debito", label: "Tarjeta de débito", corto: "Débito", tecla: "2", referencia: "N° de autorización / voucher" },
  { value: "tarjeta_credito", label: "Tarjeta de crédito", corto: "Crédito", tecla: "3", referencia: "N° de autorización / voucher" },
  { value: "transferencia", label: "Transferencia", corto: "Transferencia", tecla: "4", referencia: "N° de operación", banco: true },
  { value: "qr", label: "QR / billetera", corto: "QR / billetera", tecla: "5", referencia: "N° de operación" },
  { value: "cheque", label: "Cheque", corto: "Cheque", tecla: "6", referencia: "N° de cheque", banco: true },
];

const ETIQUETAS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta_debito: "Tarjeta de débito",
  tarjeta_credito: "Tarjeta de crédito",
  pos_debito: "Tarjeta de débito",
  pos_credito: "Tarjeta de crédito",
  tarjeta: "Tarjeta",
  pos: "Tarjeta",
  transferencia: "Transferencia",
  qr: "QR / billetera",
  billetera: "QR / billetera",
  cheque: "Cheque",
  mixto: "Mixto",
  credito: "Crédito",
  saldo_favor: "Saldo a favor",
  otro: "Otro",
};
export const metodoLabel = (m: string | null | undefined) => (m ? ETIQUETAS[m.trim().toLowerCase()] ?? m : "—");

// ── Retiros / ingresos de efectivo ──────────────────────────────────────────
export const MOTIVOS_RETIRO = [
  { value: "deposito_banco", label: "Depósito en banco" },
  { value: "retiro_dueno", label: "Retiro del dueño" },
  { value: "caja_fuerte", label: "A caja fuerte" },
  { value: "otro", label: "Otro motivo" },
] as const;
export const MOTIVOS_INGRESO = [
  { value: "cambio", label: "Cambio / sencillo" },
  { value: "aporte", label: "Aporte de efectivo" },
  { value: "devolucion_retiro", label: "Devolución de un retiro" },
  { value: "otro", label: "Otro motivo" },
] as const;

/** Billetes y monedas de Paraguay (para contar el efectivo en el cierre). */
export const DENOMINACIONES = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100, 50];

export { ROLES_CAJA } from "@/erp2/modules/caja/lib";

// ── Datos ────────────────────────────────────────────────────────────────────
export const URL_CAJAS = "/api/caja/cajas";

export function invalidarCajas() {
  invalidar(URL_CAJAS);
}

/** Estado de las cajas (stale-while-revalidate). `recarga` al cambiar pide de nuevo. */
export function useEstadoCajas(recarga = 0) {
  const [datos, setDatos] = useState<EstadoCajas | null>(() => guardadoAlInstante<EstadoCajas>(URL_CAJAS) ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    apiFetchSWR<EstadoCajas>(URL_CAJAS, (d) => { setDatos(d); setError(null); }, { fresco: recarga > 0, signal: ctrl.signal })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); });
    return () => ctrl.abort();
  }, [recarga]);
  return { datos, error, cargando: !datos && !error };
}

export const getResumenTurno = (id: string) => apiFetch<ResumenTurno>(`/api/caja/turnos/${id}`);

export async function abrirCaja(puntoVentaId: string, monto: number, observacion: string | null) {
  const r = await apiFetch<{ caja_id: string; numero_caja: number }>("/api/caja", {
    method: "POST",
    body: JSON.stringify({ punto_venta_id: puntoVentaId, monto_apertura: monto, observacion }),
  });
  invalidarCajas();
  return r;
}

export async function cerrarCaja(p: {
  caja_id: string;
  monto_cierre_contado: number;
  declarado: Record<string, number>;
  billetes: Record<string, number> | null;
  motivo_diferencia: string | null;
  observacion: string | null;
}) {
  const r = await apiFetch<{ caja_id: string; numero_caja: number; contado: number; esperado: number; diferencia: number; diferencia_otros: number }>(
    "/api/caja/cierre",
    { method: "POST", body: JSON.stringify(p) },
  );
  invalidarCajas();
  return r;
}

export async function registrarMovimiento(p: { caja_id: string; tipo: "retiro" | "ingreso"; motivo: string; detalle: string | null; monto: number }) {
  const r = await apiFetch<{ id: string; numero: string }>("/api/caja/movimientos", { method: "POST", body: JSON.stringify(p) });
  invalidarCajas();
  return r;
}

export async function anularMovimiento(id: string, motivo: string) {
  await apiFetch(`/api/caja/movimientos/${id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
  invalidarCajas();
}

// ── Caja elegida en este navegador (POS) ─────────────────────────────────────
const CLAVE_CAJA = "neura.caja.turno";

export function cajaGuardada(usuarioId: string | undefined): string | null {
  try {
    return localStorage.getItem(`${CLAVE_CAJA}.${usuarioId ?? "anon"}`);
  } catch {
    return null;
  }
}
export function guardarCaja(usuarioId: string | undefined, turnoId: string | null) {
  try {
    const k = `${CLAVE_CAJA}.${usuarioId ?? "anon"}`;
    if (turnoId) localStorage.setItem(k, turnoId);
    else localStorage.removeItem(k);
  } catch { /* sin storage: se usa la predeterminada */ }
}

/** La caja a usar: la elegida en este navegador (si sigue abierta), la predeterminada, o la única. */
export function cajaEnUso(estado: EstadoCajas | null, elegida: string | null): CajaAbierta | null {
  if (!estado) return null;
  const { abiertas } = estado;
  return (
    abiertas.find((c) => c.id === elegida) ??
    abiertas.find((c) => c.id === estado.predeterminada) ??
    (abiertas.length === 1 ? abiertas[0] : null)
  );
}

export const etiquetaCaja = (c: { punto_nombre: string; sucursal_nombre: string }) => `${c.punto_nombre} · ${c.sucursal_nombre}`;

export function fechaHora(iso: string | null | undefined) {
  if (!iso) return "—";
  return fechaHoraPY(iso);
}
export function hora(iso: string) {
  return horaPY(iso);
}

// ── Turnos viejos: la fecha se muestra si no es de hoy y se avisa pasadas 24 h ──
const TZ = "America/Asuncion";
const diaClave = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
/** "14/10" (día y mes, hora de Paraguay). */
export const diaMes = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", timeZone: TZ });
export const esDeHoy = (iso: string) => diaClave(new Date(iso)) === diaClave(new Date());
/** Desde cuándo está abierto: hoy "09:36 a. m."; otro día "el 14/10 09:36 a. m.". */
export function desdeTurno(iso: string) {
  return esDeHoy(iso) ? hora(iso) : `el ${diaMes(iso)} ${hora(iso)}`;
}
/** Turno abierto hace más de 24 h → { fecha "14/10", dias } (null si es reciente). */
export function turnoViejo(iso: string | null | undefined): { fecha: string; dias: number } | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!(ms > 24 * 3600_000)) return null;
  return { fecha: diaMes(iso), dias: Math.floor(ms / (24 * 3600_000)) };
}
export const haceDias = (dias: number) => `hace ${dias} día${dias === 1 ? "" : "s"}`;
