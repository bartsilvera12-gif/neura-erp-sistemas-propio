/** Compras: tipos compartidos (cliente y servidor). */
export type CompraItem = {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  cantidad: number;
  costo_unitario_original: number;
  costo_unitario: number;
  tipo_iva: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta_nuevo: number | null;
  /** productos con lotes: lote y vencimiento con que entró */
  lote_numero?: string | null;
  lote_vencimiento?: string | null;
};

/** Línea de GASTO de una compra (receta 59): no toca stock, cuenta como gasto operativo. */
export type CompraGasto = {
  id: string;
  orden: number;
  categoria_id: string | null;
  categoria_nombre: string | null;
  rubro_nombre?: string | null;
  tipo_costo?: "fijo" | "variable" | null;
  descripcion: string;
  /** en la moneda de la compra */
  monto_original: number;
  /** en Gs. */
  monto: number;
  iva_tipo: "10%" | "5%" | "exenta";
  monto_iva: number;
  deducible: boolean;
  sucursal_id: string | null;
  sucursal_nombre?: string | null;
  empleado_id: string | null;
  empleado_nombre?: string | null;
};

/** mercadería = solo productos · gasto = solo gastos · mixta = las dos cosas. */
export type TipoCompra = "mercaderia" | "gasto" | "mixta";
export const TIPO_COMPRA: Record<TipoCompra, { t: string; c: string }> = {
  mercaderia: { t: "Mercadería", c: "bg-sky-50 text-sky-700" },
  gasto: { t: "Gasto", c: "bg-violet-50 text-violet-700" },
  mixta: { t: "Mixta", c: "bg-amber-50 text-amber-700" },
};

export type Compra = {
  id: string;
  numero_control: string;
  /** null: gasto sin comprobante fiscal y sin proveedor (sueldo, propina…) */
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  fecha: string;
  fecha_factura: string | null;
  nro_timbrado: string | null;
  numero_factura: string | null;
  tipo?: TipoCompra;
  sucursal_id?: string | null;
  sucursal?: { nombre: string } | null;
  con_comprobante?: boolean;
  tipo_comprobante?: string | null;
  cuenta_bancaria_id?: string | null;
  cuenta?: { banco_nombre: string; numero: string; alias: string | null } | null;
  total_mercaderia?: number;
  total_gastos?: number;
  exenta?: number;
  total_5?: number;
  iva_5?: number;
  total_10?: number;
  iva_10?: number;
  iva_credito?: number;
  gastos?: CompraGasto[];
  tipo_pago: "contado" | "credito";
  /** contado: cómo se pagó (efectivo = salió de la caja) */
  medio_pago?: "efectivo" | "transferencia" | "cheque" | "tarjeta" | "otro" | null;
  referencia_pago?: string | null;
  plazo_dias: number | null;
  vencimiento: string | null;
  moneda: "GS" | "USD";
  tipo_cambio: number;
  subtotal: number;
  monto_iva: number;
  total: number;
  estado: "registrada" | "anulada";
  observacion: string | null;
  usuario_nombre: string | null;
  anulada_at: string | null;
  anulada_por: string | null;
  anulada_motivo: string | null;
  /** recepción de una orden de compra */
  orden_compra_id?: string | null;
  oc?: { numero_oc: string } | null;
  /** depósito al que entró la mercadería (Fase 1: sucursales y depósitos) */
  deposito_id?: string | null;
  deposito?: { nombre: string } | null;
  items?: CompraItem[];
  /** en la lista: la deuda de una compra a crédito */
  deuda?: { saldo: number; estado: "pendiente" | "parcial" | "pagada" | "anulada"; moneda: "GS" | "USD" } | null;
  cantidad_items?: number;
  /** Solo en el detalle de una compra a crédito: su cuenta a pagar y los pagos aplicados. */
  cuenta_pagar?: CuentaPagarCompra | null;
};

export type CuentaPagarCompra = {
  id: string;
  numero: string;
  fecha_emision: string;
  vencimiento: string;
  moneda: "GS" | "USD";
  monto: number;
  pagado: number;
  saldo: number;
  estado: "pendiente" | "parcial" | "pagada" | "anulada";
  pagos: { id: string; numero: string; fecha: string; monto: number; anulado_at: string | null }[];
};

export const COLS_COMPRA =
  "id, numero_control, proveedor_id, proveedor_nombre, fecha, fecha_factura, nro_timbrado, numero_factura, tipo_pago, plazo_dias, vencimiento, moneda, tipo_cambio, subtotal, monto_iva, total, estado, observacion, usuario_nombre, anulada_at, anulada_por, anulada_motivo, " +
  "medio_pago, referencia_pago, orden_compra_id, oc:ordenes_compra(numero_oc), deposito_id, deposito:depositos(nombre), " +
  "tipo, sucursal_id, sucursal:sucursales(nombre), con_comprobante, tipo_comprobante, cuenta_bancaria_id, cuenta:cuentas_bancarias(banco_nombre, numero, alias), " +
  "total_mercaderia, total_gastos, exenta, total_5, iva_5, total_10, iva_10, iva_credito";

export const COLS_GASTO_COMPRA =
  "id, orden, categoria_id, categoria_nombre, descripcion, monto_original, monto, iva_tipo, monto_iva, deducible, sucursal_id, empleado_id, " +
  "sucursal:sucursales(nombre), empleado:empleados(nombre), cat:gasto_categorias(padre_id, tipo_costo)";

export const COLS_ITEM =
  "id, producto_id, producto_nombre, producto_sku, cantidad, costo_unitario_original, costo_unitario, tipo_iva, subtotal, monto_iva, total, precio_venta_nuevo, lote_numero, lote_vencimiento";

/** Comprobante adjunto a una compra (foto o PDF de la factura). */
export type ComprobanteCompra = {
  id: string;
  compra_id: string;
  nombre: string;
  mime: string | null;
  size: number | null;
  subido_por: string | null;
  created_at: string;
};

export const COLS_COMPROBANTE = "id, compra_id, nombre, mime, size, subido_por, created_at";
