/** Cobros a clientes y cuentas por cobrar: tipos compartidos. */
export type MetodoCobro = "efectivo" | "transferencia" | "tarjeta" | "pos" | "cheque" | "otro";

export const METODOS_COBRO: { v: MetodoCobro; l: string }[] = [
  { v: "efectivo", l: "Efectivo" },
  { v: "transferencia", l: "Transferencia" },
  { v: "tarjeta", l: "Tarjeta" },
  { v: "pos", l: "POS" },
  { v: "cheque", l: "Cheque" },
  { v: "otro", l: "Otro" },
];
export const nombreMetodo = (m: string) => (m === "saldo_favor" ? "Saldo a favor" : METODOS_COBRO.find((x) => x.v === m)?.l ?? m);

export type CuentaCobrar = {
  id: string;
  venta_id: string;
  numero: string;
  fecha_emision: string;
  vencimiento: string;
  monto: number;
  cobrado: number;
  saldo: number;
  estado: "pendiente" | "parcial" | "pagada" | "anulada";
  dias_atraso: number;
  cliente_id?: string;
  cliente_nombre?: string;
  cliente_telefono?: string | null;
};

export type Cobro = {
  id: string;
  numero_recibo: string;
  fecha: string;
  total: number;
  observacion: string | null;
  usuario: string | null;
  anulado_at: string | null;
  anulado_motivo: string | null;
  pagos: { metodo: string; monto: number; referencia: string | null }[] | null;
  aplicado_a: { numero: string; monto: number }[] | null;
};

export type EstadoCuenta = { cuentas: CuentaCobrar[]; cobros: Cobro[]; deuda: number; vencido: number; saldo_favor: number };
