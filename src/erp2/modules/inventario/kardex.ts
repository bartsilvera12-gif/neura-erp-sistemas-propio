/** Kardex: etiquetas compartidas (pantalla y Excel). */
export type TipoMovimiento = "ENTRADA" | "SALIDA";
export type OrigenMovimiento =
  | "inventario_inicial" | "ajuste_manual" | "venta" | "anulacion_venta" | "compra" | "anulacion_compra"
  | "traslado_salida" | "traslado_entrada" | "anulacion_traslado" | "ajuste" | "perdida"
  | "anulacion_ajuste" | "anulacion_perdida" | "apertura" | "produccion" | "anulacion_produccion"
  | "devolucion_venta" | "anulacion_devolucion";
export type DocumentoTipo = "compra" | "venta" | "traslado" | "ajuste" | "perdida" | "produccion" | "nota_credito";

export type Movimiento = {
  id: string;
  producto_id: string;
  producto_nombre: string | null;
  producto_sku: string | null;
  tipo: TipoMovimiento;
  cantidad: number;
  costo_unitario: number;
  origen: OrigenMovimiento;
  referencia: string | null;
  proveedor?: string | null;
  numero_factura?: string | null;
  usuario_nombre: string | null;
  fecha: string;
  deposito_id?: string | null;
  deposito_nombre?: string | null;
  sucursal_nombre?: string | null;
  documento_tipo?: DocumentoTipo | null;
  documento_id?: string | null;
  documento_numero?: string | null;
  deposito_contraparte_id?: string | null;
  contraparte_nombre?: string | null;
  /** stock después del movimiento (solo en el historial de UN producto) */
  saldo?: number | null;
};

export const ORIGEN_LABEL: Record<string, string> = {
  compra: "Recarga (compra)",
  venta: "Venta",
  anulacion_venta: "Anulación de venta",
  anulacion_compra: "Anulación de compra",
  traslado_salida: "Traslado (salida)",
  traslado_entrada: "Traslado (entrada)",
  anulacion_traslado: "Traslado anulado",
  ajuste: "Ajuste",
  inventario_inicial: "Inventario inicial",
  perdida: "Pérdida",
  anulacion_ajuste: "Anulación de ajuste",
  anulacion_perdida: "Anulación de pérdida",
  apertura: "Saldo de apertura",
  ajuste_manual: "Ajuste manual (anterior)",
  produccion: "Producción",
  anulacion_produccion: "Anulación de producción",
  devolucion_venta: "Devolución de cliente",
  anulacion_devolucion: "Anulación de devolución",
};

/** Pestañas del kardex: cada una es un grupo de orígenes (se mandan separados por coma). */
export const GRUPOS_ORIGEN: { id: string; label: string; origenes: OrigenMovimiento[] }[] = [
  { id: "", label: "Todos", origenes: [] },
  { id: "recargas", label: "Recargas de stock", origenes: ["compra"] },
  { id: "ventas", label: "Ventas", origenes: ["venta", "devolucion_venta"] },
  { id: "traslados", label: "Traslados", origenes: ["traslado_salida", "traslado_entrada", "anulacion_traslado"] },
  { id: "ajustes", label: "Ajustes", origenes: ["ajuste", "inventario_inicial", "ajuste_manual", "apertura"] },
  { id: "perdidas", label: "Pérdidas", origenes: ["perdida"] },
  { id: "produccion", label: "Producción", origenes: ["produccion"] },
  { id: "anulaciones", label: "Anulaciones", origenes: ["anulacion_venta", "anulacion_compra", "anulacion_ajuste", "anulacion_perdida", "anulacion_produccion", "anulacion_devolucion"] },
];

/** Adónde lleva el número de documento de un movimiento. */
export function hrefDocumento(m: Pick<Movimiento, "documento_tipo" | "documento_id">): string | null {
  if (!m.documento_id) return null;
  switch (m.documento_tipo) {
    case "traslado": return `/inventario/traslados?ver=${m.documento_id}`;
    case "ajuste":
    case "perdida": return `/inventario/ajustes?ver=${m.documento_id}`;
    case "compra": return `/compras?ver=${m.documento_id}`;
    case "produccion": return `/inventario/produccion?ver=${m.documento_id}`;
    case "nota_credito": return `/caja/notas-credito?ver=${m.documento_id}`;
    default: return null;
  }
}
