import type { TipoIva } from "@/erp2/modules/caja/lib";

/** Tipo de producto (receta 72; el "Fabricado" de la 97 se fue en la 160: pasó a Menú). */
export type TipoProducto = "reventa" | "menu" | "materia_prima";

export const TIPOS_PRODUCTO: { id: TipoProducto; label: string; corto: string; ayuda: string; chip: string }[] = [
  { id: "reventa", label: "Reventa", corto: "Reventa", ayuda: "Se compra y se vende tal cual, con stock propio (bebidas, almacén).", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
  { id: "menu", label: "Menú", corto: "Menú", ayuda: "Plato o elaborado: no lleva stock; al venderse descuenta los ingredientes de su receta.", chip: "bg-orange-50 text-orange-700 ring-orange-200" },
  { id: "materia_prima", label: "Materia prima", corto: "Materia prima", ayuda: "Insumo: se compra y tiene stock, pero no se vende. Con receta es una preparación.", chip: "bg-lime-50 text-lime-800 ring-lime-200" },
];
export const tipoProducto = (t: string | null | undefined) => TIPOS_PRODUCTO.find((x) => x.id === t) ?? TIPOS_PRODUCTO[0];

/** Unidades de una materia prima (la receta convierte g↔kg y ml↔l). */
export const UNIDADES_MP = ["Unidad", "kg", "g", "l", "ml"] as const;

/** Producto tal como lo gestiona Inventario (más campos que el de la caja). */
export type ProductoInventario = {
  id: string;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  palabras_clave?: string | null;
  categoria_principal_id: string | null;
  proveedor_principal_id?: string | null;
  costo_promedio: number | null;
  precio_venta: number;
  precio_mayorista: number | null;
  precio_distribuidor: number | null;
  /** Receta 173: desde cuántas unidades rige el precio mayorista / distribuidor (null = 10 / 20). */
  mayorista_desde?: number | null;
  distribuidor_desde?: number | null;
  descuento_pct: number | null;
  stock_actual: number;
  stock_minimo: number;
  unidad_medida: string;
  tipo_iva: TipoIva;
  controla_stock: boolean;
  /** lotes con vencimiento (perecibles): cada entrada lleva lote + vencimiento; salida FEFO */
  controla_lotes?: boolean;
  es_vendible: boolean;
  /** receta 72: reventa · menu (sin stock, descuenta su receta) · materia_prima (no se vende) */
  tipo_producto?: TipoProducto;
  /** receta 68: sale en el menú QR de las mesas (viene en el detalle, no en la lista) */
  en_menu_qr?: boolean;
  /** receta 70: estación de cocina propia (excepción; null = la de su categoría). Viene en el detalle. */
  estacion_id?: string | null;
  activo: boolean;
  imagen_url: string | null;
  /** lista paginada de Inventario: unidades por depósito (solo los que tienen) */
  stock_depositos?: { d: string; c: number }[];
};
