/**
 * Tipos y reglas de la caja (POS). Portado de distribuidorajm y re-plomado al 2.0:
 * el precio y el IVA son los del CATÁLOGO (la base manda), así que acá se calculan
 * igual que en el servidor para que lo que el cajero ve sea lo que se cobra.
 */
import type { ModsCatalogo } from "@/erp2/modules/mesas/modificadores";

export type TipoIva = "EXENTA" | "5%" | "10%";
export type Moneda = "GS" | "USD";
export type TipoPrecio = "minorista" | "mayorista" | "distribuidor";
export type MetodoCobro = "efectivo" | "transferencia" | "tarjeta" | "cheque";

export type Producto = {
  id: string;
  nombre: string;
  sku: string;
  /** para el lector de códigos en la caja */
  codigo_barras?: string | null;
  precio_venta: number;
  precio_mayorista: number | null;
  precio_distribuidor: number | null;
  /** Receta 173: desde cuántas unidades rige el precio mayorista / distribuidor (null = 10 / 20). */
  mayorista_desde?: number | null;
  distribuidor_desde?: number | null;
  stock_actual: number;
  unidad_medida: string;
  tipo_iva: TipoIva;
  controla_stock: boolean;
  imagen_url?: string | null;
  /** Descuento del producto (%), definido en Inventario. La caja lo aplica solo. */
  descuento_pct?: number;
  /** Productos con lotes: unidades en lotes VENCIDOS (la caja no las vende; avisa sin bloquear). */
  stock_vencido?: number;
  /** Receta 72: "menu" = plato (stock_actual = porciones posibles según su receta). */
  tipo_producto?: string;
  /** Receta 72: plato sin receta (no se puede vender hasta cargarla). */
  sin_receta?: boolean;
  /** Receta 73: quitar / extras / opciones del plato (null = se agrega directo). */
  mods?: ModsCatalogo | null;
};

export type Cliente = {
  id: string;
  nombre: string;
  documento?: string | null;
  tipo_cliente?: "empresa" | "persona";
  razon_social?: string | null;
  ruc?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  condicion_pago?: string;
  plazo_dias?: number | null;
  limite_credito?: number;
  origen?: string;
  notas?: string | null;
  activo?: boolean;
  vendedor_usuario_id?: string | null;
  creado_at?: string;
};

export const METODOS_COBRO: { value: MetodoCobro; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "cheque", label: "Cheque" },
];

export const LISTAS: { value: TipoPrecio; label: string }[] = [
  { value: "minorista", label: "Minorista" },
  { value: "mayorista", label: "Mayorista" },
  { value: "distribuidor", label: "Distribuidor" },
];

export const IVAS: { value: TipoIva; label: string }[] = [
  { value: "10%", label: "10%" },
  { value: "5%", label: "5%" },
  { value: "EXENTA", label: "Exenta" },
];

/** Precio unitario según la lista. Mismo fallback que `crear_venta` en la base. */
export function precioSegunLista(p: Producto, lista: TipoPrecio): number {
  if (lista === "mayorista") return p.precio_mayorista ?? p.precio_venta;
  if (lista === "distribuidor") return p.precio_distribuidor ?? p.precio_venta;
  return p.precio_venta;
}

/**
 * IVA CONTENIDO en un importe (no agregado): en Paraguay el precio ya lo lleva
 * adentro. Con 10% el importe es 110% de la base → iva = importe/11; con 5% → /21.
 */
export function calcIva(tipo: TipoIva, importe: number): number {
  if (tipo === "EXENTA") return 0;
  if (tipo === "5%") return Math.round((importe * 5) / 105);
  return Math.round((importe * 10) / 110);
}

export function formatGs(valor: number): string {
  // `|| 0`: sin "Gs. -0" (un -0 de restar nada) ni "Gs. NaN" (un dato que no llegó).
  return `Gs. ${(Math.round(valor) || 0).toLocaleString("es-PY")}`;
}

/** Roles que operan la caja (abrir, vender, cobrar, retirar, cerrar). */
export const ROLES_CAJA = ["ADMIN", "SUPERVISOR", "CAJERO", "VENDEDOR"];
