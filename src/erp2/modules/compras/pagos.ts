/** Pagos a proveedores y cuentas por pagar: tipos y formato compartidos (cliente y servidor). */
export type Moneda = "GS" | "USD";
export type MetodoPagoProv = "efectivo" | "transferencia" | "cheque" | "tarjeta" | "otro";

export const METODOS_PAGO_PROV: { v: MetodoPagoProv; l: string }[] = [
  { v: "transferencia", l: "Transferencia" },
  { v: "efectivo", l: "Efectivo" },
  { v: "cheque", l: "Cheque" },
  { v: "tarjeta", l: "Tarjeta" },
  { v: "otro", l: "Otro" },
];
export const nombreMetodoPago = (m: string) => METODOS_PAGO_PROV.find((x) => x.v === m)?.l ?? m;

/** Lista unificada "Compras y gastos" (receta 59) abierta en una compra o en un gasto anterior. */
export const hrefCompra = (id: string) => `/compras?ver=${id}&desde=&hasta=`;
export const hrefGasto = (id: string) => `/compras?gasto=${id}&desde=&hasta=`;

/** Pantalla del documento que originó la deuda: la compra o el gasto anterior. */
export const hrefOrigenCxp = (c: { compra_id?: string | null; gasto_id?: string | null }) =>
  c.gasto_id ? hrefGasto(c.gasto_id) : hrefCompra(c.compra_id ?? "");

/** Gs. 1.250.000 · US$ 1.250,50 */
export function dinero(v: number, moneda: Moneda | string = "GS") {
  const n = Number(v) || 0;
  return moneda === "USD"
    ? `US$ ${n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}
/** Redondeo según moneda (Gs. sin decimales, USD con 2). */
export const redondear = (v: number, moneda: Moneda | string) => (moneda === "USD" ? Math.round((Number(v) || 0) * 100) / 100 : Math.round(Number(v) || 0));

export type EstadoCxp = "pendiente" | "parcial" | "pagada" | "anulada";

export type CuentaPagar = {
  id: string;
  /** Origen de la deuda: una compra a crédito o un gasto a crédito (Gastos y Servicios). */
  compra_id: string | null;
  gasto_id?: string | null;
  proveedor_id: string;
  numero: string; // factura del proveedor
  fecha_emision: string;
  vencimiento: string;
  moneda: Moneda;
  monto: number;
  pagado: number;
  saldo: number;
  estado: EstadoCxp;
  proveedor_nombre: string;
  proveedor_ruc: string | null;
  proveedor_telefono: string | null;
  compra_numero: string;
  dias_atraso: number;
  dias_para_vencer: number;
};

export type AntiguedadPagar = {
  por_vencer: number;
  vence_semana: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90: number;
  proveedores: number;
  total: number;
  pagado_mes: number;
};

export type ListaCuentasPagar = { total: number; total_saldo: number; rows: CuentaPagar[]; antiguedad: AntiguedadPagar };

export type MedioPago = { metodo: string; monto: number; referencia: string | null };

export type PagoProveedor = {
  id: string;
  numero: string;
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  moneda: Moneda;
  total: number;
  caja_id: string | null;
  observacion: string | null;
  usuario_nombre: string | null;
  anulado_at: string | null;
  anulado_por: string | null;
  anulado_motivo: string | null;
  medios: MedioPago[];
  aplicaciones?: { monto: number; cxp_id: string; numero: string; compra_id: string | null; gasto_id?: string | null; compra_numero: string | null }[];
};

/** Cuenta tal como la devuelve estado_cuenta_proveedor. */
export type CuentaProveedor = {
  id: string;
  compra_id: string | null;
  gasto_id?: string | null;
  compra_numero: string;
  numero: string;
  fecha_emision: string;
  vencimiento: string;
  moneda: Moneda;
  monto: number;
  pagado: number;
  saldo: number;
  estado: EstadoCxp;
  dias_atraso: number;
};

export type PagoEstadoCuenta = {
  id: string;
  numero: string;
  fecha: string;
  moneda: Moneda;
  total: number;
  observacion: string | null;
  usuario: string | null;
  anulado_at: string | null;
  anulado_motivo: string | null;
  medios: MedioPago[] | null;
  aplicado_a: { numero: string; monto: number }[] | null;
};

export type EstadoCuentaProveedor = {
  cuentas: CuentaProveedor[];
  pagos: PagoEstadoCuenta[];
  deuda_gs: number;
  deuda_usd: number;
  vencido_gs: number;
};

export const ESTADO_CXP: Record<string, { t: string; c: string }> = {
  pendiente: { t: "Pendiente", c: "bg-sky-50 text-sky-700" },
  parcial: { t: "Pagada en parte", c: "bg-amber-50 text-amber-700" },
  pagada: { t: "Pagada", c: "bg-emerald-50 text-emerald-700" },
  anulada: { t: "Anulada", c: "bg-slate-100 text-slate-500" },
};

/** Texto del vencimiento: "vence hoy", "vence en 3 días", "5 días de atraso". */
export function textoVencimiento(diasAtraso: number, diasParaVencer: number) {
  if (diasAtraso > 0) return { t: `${diasAtraso} ${diasAtraso === 1 ? "día" : "días"} de atraso`, c: "font-semibold text-rose-600" };
  if (diasParaVencer === 0) return { t: "vence hoy", c: "font-semibold text-amber-600" };
  if (diasParaVencer <= 7) return { t: `vence en ${diasParaVencer} ${diasParaVencer === 1 ? "día" : "días"}`, c: "font-semibold text-amber-600" };
  return { t: `vence en ${diasParaVencer} días`, c: "text-slate-500" };
}
