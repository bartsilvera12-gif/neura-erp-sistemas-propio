/**
 * Notas de crédito (receta 99). Tipos compartidos por el modal de Nueva nota (desde el detalle
 * de la venta), Caja › Notas de crédito, su detalle y el PDF.
 */

export type ItemPrevia = {
  id: string;
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  modificadores_texto: string | null;
  cantidad: number;
  precio_venta: number;
  total_linea: number;
  tipo_iva: string | null;
  unidad_medida: string | null;
  devuelto: number;
  disponible: number;
  monto_disponible: number;
  /** plato con receta: devuelve sus ingredientes */
  receta: boolean;
  /** el producto (o su receta) mueve stock */
  mueve_stock: boolean;
};

export type NotaResumen = { id: string; numero: string; fecha: string; total: number; estado: "emitida" | "anulada"; tipo: TipoNota; motivo: string };

export type NotaCreditoPrevia = {
  venta: {
    id: string;
    numero_control: string;
    fecha: string;
    total: number;
    estado: string;
    tipo_venta: "CONTADO" | "CREDITO";
    tipo_documento: "factura" | "ticket" | null;
    cliente_id: string | null;
    cliente_nombre: string;
    horas: number;
    /** factura dentro de las 48 h (o ticket): se puede anular entera */
    factura_anulable: boolean;
  };
  acreditado: number;
  disponible: number;
  deuda: number;
  saldo_favor: number;
  caja: { id: string; etiqueta: string; efectivo: number } | null;
  items: ItemPrevia[];
  notas: NotaResumen[];
};

export type TipoNota = "devolucion" | "descuento";
export type DestinoNota = "devolver" | "saldo_favor";
export type MetodoDevolucion = "efectivo" | "transferencia" | "tarjeta_debito" | "tarjeta_credito" | "qr" | "cheque" | "otro";

export const METODOS_DEVOLUCION: [MetodoDevolucion, string][] = [
  ["efectivo", "Efectivo"],
  ["transferencia", "Transferencia"],
  ["tarjeta_debito", "Tarjeta de débito"],
  ["tarjeta_credito", "Tarjeta de crédito"],
  ["qr", "QR / billetera"],
  ["cheque", "Cheque"],
  ["otro", "Otra"],
];
export const metodoDevolucionLabel = (m: string | null | undefined) => METODOS_DEVOLUCION.find(([v]) => v === m)?.[1] ?? "Efectivo";

export type NotaCreditoFila = {
  id: string;
  numero: string;
  fecha: string;
  venta_id: string;
  venta_numero: string;
  cliente_nombre: string;
  tipo: TipoNota;
  motivo: string;
  total: number;
  a_cuenta: number;
  devuelto: number;
  a_favor: number;
  estado: "emitida" | "anulada";
  usuario_nombre: string | null;
};

export type ListaNotas = { rows: NotaCreditoFila[]; total: number; totales: { cantidad: number; total: number } };

export type NotaCreditoDetalle = {
  nota: {
    id: string;
    numero: string;
    /** Receta 101: solo si corrige una factura del autoimpresor con número. */
    fiscal_numero?: string | null;
    fiscal_timbrado?: string | null;
    venta_id: string;
    cliente_id: string | null;
    fecha: string;
    tipo: TipoNota;
    motivo: string;
    subtotal: number;
    monto_iva: number;
    total: number;
    a_cuenta: number;
    devuelto: number;
    a_favor: number;
    metodo_devolucion: string | null;
    referencia_devolucion: string | null;
    caja_id: string | null;
    estado: "emitida" | "anulada";
    usuario_nombre: string | null;
    anulada_at: string | null;
    anulada_por_nombre: string | null;
    anulada_motivo: string | null;
  };
  venta: { id: string; numero_control: string; fiscal_numero?: string | null; fiscal_timbrado?: string | null; fecha: string; total: number; tipo_venta: string; tipo_documento: string | null; receptor_nombre: string | null; receptor_ruc: string | null };
  cliente: { id: string; nombre: string; documento: string | null } | null;
  cliente_nombre: string;
  caja: { id: string; etiqueta: string; numero_caja: number | null; estado: string } | null;
  deposito: string | null;
  items: {
    id: string;
    producto_nombre: string;
    sku: string | null;
    cantidad: number;
    precio_unitario: number;
    tipo_iva: string | null;
    monto_iva: number;
    total_linea: number;
    mueve_stock: boolean;
    vuelve_stock: boolean;
  }[];
  aplicaciones: { numero: string; vencimiento: string; monto: number }[];
  saldo_favor_usado: boolean;
};

/** "Devolución de productos" · "Descuento / bonificación". */
export const tipoNotaLabel = (t: TipoNota) => (t === "descuento" ? "Descuento / bonificación" : "Devolución de productos");

/** A dónde fue la plata, en una línea: "Bajó la deuda Gs. 5.500 · devuelto Gs. 2.000". */
export function destinoTexto(n: { a_cuenta: number; devuelto: number; a_favor: number }, fmt: (v: number) => string): string {
  return [
    n.a_cuenta > 0 ? `bajó la deuda ${fmt(n.a_cuenta)}` : null,
    n.devuelto > 0 ? `devuelto ${fmt(n.devuelto)}` : null,
    n.a_favor > 0 ? `a favor ${fmt(n.a_favor)}` : null,
  ].filter(Boolean).join(" · ").replace(/^./, (c) => c.toUpperCase());
}
