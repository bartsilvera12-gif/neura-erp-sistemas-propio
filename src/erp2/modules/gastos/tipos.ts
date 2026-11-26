/** Gastos empresariales (gastos operativos): tipos y helpers compartidos (cliente). */
export type EstadoGasto = "borrador" | "confirmado" | "anulado";
export type IvaTipo = "10%" | "5%" | "exenta";
export type TipoPago = "contado" | "credito";
export type MedioPagoGasto = "efectivo" | "transferencia" | "cheque" | "tarjeta" | "otro";
export type Moneda = "GS" | "USD";
export type TipoCosto = "fijo" | "variable";

export const TIPOS_COMPROBANTE = [
  "Factura", "Factura Electrónica", "Factura Virtual", "Autofactura", "Boleta",
  "Nota de Débito", "Recibo", "Otro",
];

export const MEDIOS_PAGO_GASTO: { v: MedioPagoGasto; l: string }[] = [
  { v: "transferencia", l: "Transferencia" },
  { v: "efectivo", l: "Efectivo (sale de la caja)" },
  { v: "tarjeta", l: "Tarjeta" },
  { v: "cheque", l: "Cheque" },
  { v: "otro", l: "Otro" },
];
export const nombreMedioGasto = (m: string | null | undefined) =>
  m === "efectivo" ? "Efectivo" : MEDIOS_PAGO_GASTO.find((x) => x.v === m)?.l ?? (m || "—");
/** Medios que salen de una cuenta bancaria propia. */
export const usaCuentaBancaria = (m: string | null | undefined) => m === "transferencia" || m === "cheque" || m === "tarjeta";

export const ESTADO_GASTO: Record<EstadoGasto, { t: string; c: string }> = {
  borrador: { t: "Borrador", c: "bg-slate-100 text-slate-600" },
  confirmado: { t: "Confirmado", c: "bg-emerald-50 text-emerald-700" },
  anulado: { t: "Anulado", c: "bg-rose-50 text-rose-600" },
};

/** IVA INCLUIDO (Paraguay): del monto se deduce el IVA (10 % → /11, 5 % → /21). USD con 2 decimales. */
export const ivaDe = (monto: number, tipo: IvaTipo, moneda: Moneda = "GS") => {
  const f = moneda === "USD" ? 100 : 1;
  const r = (n: number) => Math.round(n * f) / f;
  return tipo === "10%" ? r(monto / 11) : tipo === "5%" ? r(monto / 21) : 0;
};

/** Timbrado no requerido para Recibo / Otro (la misma regla que la base). */
export const requiereTimbrado = (tipo: string | null | undefined) => !["", "recibo", "otro"].includes((tipo ?? "").trim().toLowerCase());

/** Número de comprobante con guiones automáticos 3-3-7 (001-001-0000001). */
export function formatComprobante(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13);
  let out = d.slice(0, 3);
  if (d.length > 3) out += "-" + d.slice(3, 6);
  if (d.length > 6) out += "-" + d.slice(6, 13);
  return out;
}

// ── Catálogos ────────────────────────────────────────────────────────────────
export type Subcategoria = {
  id: string; nombre: string; orden: number; activo: boolean; tipo_costo: TipoCosto;
  deducible_iva: boolean; es_personal: boolean; usos?: number;
};
export type Rubro = { id: string; nombre: string; orden: number; activo: boolean; es_personal: boolean; subcategorias: Subcategoria[] };
export type SucursalMin = { id: string; nombre: string; es_principal?: boolean; activa?: boolean };
export type Empleado = { id: string; nombre: string; ci: string | null; cargo: string | null; sucursal_id: string | null; activo: boolean };
export type CuentaBancaria = {
  id: string; banco_id: string | null; banco_nombre: string; numero: string; moneda: Moneda;
  titular: string | null; alias: string | null; activa: boolean;
};
export type UltimoProveedor = {
  categoria_id: string | null; sucursal_id: string | null; tipo_comprobante: string | null; timbrado: string | null;
  tipo_pago: TipoPago | null; medio_pago: MedioPagoGasto | null; plazo_dias: number | null; iva_tipo: IvaTipo | null;
  descripcion: string | null; cuenta_bancaria_id: string | null; moneda: Moneda | null;
};
export type Catalogos = {
  rubros: Rubro[];
  sucursales: SucursalMin[];
  empleados: Empleado[];
  cuentas_bancarias: CuentaBancaria[];
  bancos: { id: string; nombre: string }[];
  ultimos: Record<string, UltimoProveedor>;
  mi_sucursal_id: string | null;
};
export const URL_CATALOGOS = "/api/gastos/catalogos";

/** Subcategoría por id con su rubro (para mostrar "Rubro › Sub"). */
export function indiceCategorias(rubros: Rubro[]) {
  const m = new Map<string, Subcategoria & { rubro: Rubro }>();
  for (const r of rubros) for (const s of r.subcategorias) m.set(s.id, { ...s, rubro: r });
  return m;
}
export const nombreCuenta = (c: Pick<CuentaBancaria, "banco_nombre" | "numero" | "alias" | "moneda">) =>
  `${c.banco_nombre} · ${c.numero}${c.alias ? ` (${c.alias})` : ""}${c.moneda === "USD" ? " · USD" : ""}`;

// ── Lista ────────────────────────────────────────────────────────────────────
export type FilaGasto = {
  id: string;
  numero: string | null;
  estado: EstadoGasto;
  fecha: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  proveedor_ruc: string | null;
  tipo_comprobante: string | null;
  numero_comprobante: string | null;
  timbrado: string | null;
  con_comprobante: boolean;
  deducible: boolean;
  descripcion: string | null;
  tipo_pago: TipoPago | null;
  medio_pago: MedioPagoGasto | null;
  fecha_vencimiento: string | null;
  fecha_programada: string | null;
  recurrente_id: string | null;
  moneda: Moneda;
  tipo_cambio: number;
  total: number;
  total_gs: number;
  monto_iva: number;
  sucursal_id: string | null;
  sucursal_nombre: string | null;
  adjuntos: number;
  categorias: string | null;
  tipos_costo: string | null;
  cxp: { id: string; saldo: number; pagado: number; estado: string } | null;
  anulado_motivo: string | null;
  usuario_nombre: string | null;
  confirmado_por: string | null;
  created_at: string;
};

export type ListaGastos = {
  rows: FilaGasto[];
  total: number;
  total_monto: number;
  total_iva: number;
  total_borradores: number;
  resumen: { total: number; borrador: number; confirmado: number; anulado: number };
};

// ── Detalle ──────────────────────────────────────────────────────────────────
export type ItemGasto = {
  id?: string;
  categoria_id: string | null;
  categoria_nombre?: string | null;
  rubro_nombre?: string | null;
  tipo_costo?: TipoCosto | null;
  es_personal?: boolean;
  descripcion: string;
  monto: number;
  iva_tipo: IvaTipo;
  monto_iva?: number;
  deducible?: boolean;
  sucursal_id: string | null;
  sucursal_nombre?: string | null;
  empleado_id: string | null;
  empleado_nombre?: string | null;
};

export type AdjuntoGasto = { id: string; nombre: string; mime: string | null; size: number | null; subido_por: string | null; created_at: string };

export type DetalleGasto = {
  gasto: {
    id: string; numero: string | null; estado: EstadoGasto; fecha: string;
    proveedor_id: string | null; proveedor_nombre: string | null; proveedor_ruc: string | null;
    sucursal_id: string | null; sucursal_nombre: string | null; con_comprobante: boolean; deducible: boolean;
    descripcion: string | null; tipo_comprobante: string | null; numero_comprobante: string | null; timbrado: string | null;
    fecha_comprobante: string | null; tipo_pago: TipoPago | null; plazo_dias: number | null; fecha_vencimiento: string | null;
    medio_pago: MedioPagoGasto | null; referencia_pago: string | null; observacion: string | null;
    cuenta_bancaria_id: string | null; cuenta_bancaria: { id: string; banco: string; numero: string; moneda: Moneda; alias: string | null } | null;
    moneda: Moneda; tipo_cambio: number; total_gs: number;
    total_10: number; iva_10: number; total_5: number; iva_5: number; exenta: number; subtotal: number; monto_iva: number; total: number;
    recurrente_id: string | null; recurrente_nombre: string | null; periodo: string | null; fecha_programada: string | null;
    usuario_nombre: string | null; created_at: string; confirmado_at: string | null; confirmado_por: string | null;
    anulado_at: string | null; anulado_por: string | null; anulado_motivo: string | null;
  };
  items: ItemGasto[];
  adjuntos: AdjuntoGasto[];
  cxp: {
    id: string; monto: number; pagado: number; saldo: number; estado: string; vencimiento: string; moneda: Moneda;
    pagos: { id: string; numero: string; fecha: string; monto: number; anulado: boolean }[];
  } | null;
  caja: { caja_id: string; numero_caja: number; monto: number; anulado: boolean } | null;
};

// ── Recurrentes ──────────────────────────────────────────────────────────────
export type ItemPlantilla = {
  categoria_id: string | null; descripcion: string; monto: number; iva_tipo: IvaTipo; sucursal_id: string | null; empleado_id: string | null;
};
export type Plantilla = {
  id: string; nombre: string; descripcion: string | null; activo: boolean; aplica: boolean;
  proveedor_id: string | null; proveedor_nombre: string | null; sucursal_id: string | null; sucursal_nombre: string | null;
  con_comprobante: boolean; tipo_comprobante: string | null; tipo_pago: TipoPago; plazo_dias: number | null;
  medio_pago: MedioPagoGasto | null; cuenta_bancaria_id: string | null; moneda: Moneda; tipo_cambio: number;
  dia_vencimiento: number; items: ItemPlantilla[]; total: number; vigente_desde: string | null; vigente_hasta: string | null;
  categorias: string | null; fecha_periodo: string;
  generado: { id: string; numero: string | null; estado: EstadoGasto; total: number; total_gs: number } | null;
  ultimo_periodo: string | null;
};
export type ListaRecurrentes = {
  periodo: string;
  plantillas: Plantilla[];
  resumen: { activas: number; aplican: number; generadas: number; pendientes: number; previsto_mes: number; a_completar: number };
};
export type Vencimiento = {
  tipo: "borrador" | "programado" | "a_pagar"; fecha: string; concepto: string; proveedor: string | null;
  moneda: Moneda; monto: number; monto_gs: number; gasto_id: string | null; compra_id: string | null;
  recurrente_id: string | null; cxp_id: string | null; vencido: boolean; dias: number;
};
export type Vencimientos = { hoy: string; hasta: string; total_gs: number; vencido_gs: number; rows: Vencimiento[] };

// ── Resumen ──────────────────────────────────────────────────────────────────
export type Resumen = {
  desde: string; hasta: string; sucursal_id: string | null;
  totales: { total: number; compras: number; operativos: number; iva_credito: number; no_deducible: number; fijo: number; variable: number; docs_compras: number; docs_gastos: number };
  anterior: { desde: string; hasta: string; total: number; compras: number; operativos: number };
  deuda: { saldo_gs: number; vencido_gs: number; cuentas: number };
  borradores: { cantidad: number; total_gs: number };
  por_rubro: { id: string | null; nombre: string; mercaderia: boolean; total: number; fijo: number; variable: number; presupuesto: number | null; subcategorias: { id: string; nombre: string; total: number }[] }[];
  por_mes: { mes: string; compras: number; operativos: number; presupuesto: number | null }[];
  por_sucursal: { id: string | null; nombre: string; compras: number; operativos: number; total: number }[];
  top_proveedores: { id: string | null; nombre: string; compras: number; operativos: number; total: number }[];
  presupuesto: { previsto: number; gastado_presupuestado: number };
  sucursales: { id: string; nombre: string }[];
};

// ── Formato (compartido con los gráficos y los reportes: src/components/graficos/formato.ts) ──
import { gs, usd } from "@/erp2/components/graficos/formato";
export { gs, usd, corto, fechaCorta, MESES, MESES_CORTOS, nombreMes, mesCorto } from "@/erp2/components/graficos/formato";
export const monto = (n: number | null | undefined, moneda: Moneda | string | null | undefined) => (moneda === "USD" ? usd(n) : gs(n));
