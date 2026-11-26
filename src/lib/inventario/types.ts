export type MetodoValuacion = "CPP" | "FIFO" | "LIFO";
export type TipoMovimiento = "ENTRADA" | "SALIDA" | "AJUSTE";
export type OrigenMovimiento =
  | "compra"
  | "venta"
  | "ajuste_manual"
  | "inventario_inicial"
  | "recepcion"
  | "ajuste"
  | "perdida"
  | "anulacion_ajuste"
  | "traslado_salida"
  | "traslado_entrada"
  | "anulacion_traslado";

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  costo_promedio: number;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  metodo_valuacion: MetodoValuacion;
  codigo_barras?: string | null;
  codigo_barras_interno?: boolean;
  imagen_path?: string | null;
  imagen_url?: string | null;
  categoria_principal_id?: string | null;
  ubicacion_principal_id?: string | null;
  proveedor_principal_id?: string | null;
}

export interface MovimientoInventario {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string;
  tipo: TipoMovimiento;
  cantidad: number;
  costo_unitario: number;
  origen: OrigenMovimiento;
  fecha: string;       // ISO string
  referencia?: string; // ej: "COMP-000001"
  created_by?: string | null;
  usuario_nombre?: string | null;
  /** Depósito donde pasó (vacío en movimientos anteriores al stock por depósito). */
  ubicacion_id?: string | null;
  ubicacion_nombre?: string | null;
  /** En un traslado, el otro depósito. */
  contraparte_nombre?: string | null;
  documento_tipo?: string | null;
  documento_id?: string | null;
  documento_numero?: string | null;
  /** Cuánto quedó en el depósito después del movimiento. */
  saldo_deposito?: number | null;
}
