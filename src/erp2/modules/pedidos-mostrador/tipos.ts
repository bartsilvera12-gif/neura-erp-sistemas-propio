/**
 * Pedidos de mostrador (receta 77). Compartido cliente/servidor.
 * El vendedor arma el pedido en Caja › Pedidos (/caja/pedidos) y lo envía a caja con un número
 * (P-0042); la caja lo cobra en Nueva venta (bandeja "Pedidos por cobrar" o escaneando el código
 * del comprobante). Vencen al cierre del día (hora de Paraguay). No reservan stock.
 */
import type { ModsSeleccion, ModsSnapshot } from "@/erp2/modules/mesas/modificadores";

export type EstadoPedidoMostrador = "en_caja" | "cobrado" | "vencido" | "anulado";

export const ESTADOS_PEDIDO_MOSTRADOR: Record<EstadoPedidoMostrador, { texto: string; clase: string }> = {
  en_caja: { texto: "En caja", clase: "bg-sky-50 text-sky-800 ring-sky-200" },
  cobrado: { texto: "Cobrado", clase: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  vencido: { texto: "Vencido", clase: "bg-amber-50 text-amber-900 ring-amber-200" },
  anulado: { texto: "Anulado", clase: "bg-slate-100 text-slate-600 ring-slate-200" },
};

export type ItemPedidoMostrador = {
  id: string;
  producto_id: string | null;
  nombre: string;
  sku: string | null;
  cantidad: number;
  /** precio_base (lista con el descuento del producto) + precio_mods */
  precio_unitario: number;
  precio_base: number;
  precio_mods: number;
  total: number;
  modificadores: ModsSnapshot | null;
  modificadores_texto: string | null;
  /** true = el precio base del pedido es el de hoy */
  precio_de_hoy: boolean;
};

export type PedidoMostrador = {
  id: string;
  numero: number;
  /** "P-0042" */
  etiqueta: string;
  estado: EstadoPedidoMostrador;
  fecha: string;
  /** Cambia con cada edición / anulación: la caja cobra la versión que cargó. */
  version: string;
  sucursal: { id: string; nombre: string };
  cliente: { id: string | null; nombre: string } | null;
  nota: string | null;
  total: number;
  creado_at: string;
  creado_por: string | null;
  vendedor: string | null;
  editado_at: string | null;
  venta: { id: string; numero: string; total: number; estado: string } | null;
  cobrado_at: string | null;
  cobrado_por_nombre: string | null;
  total_cobrado: number | null;
  modificado_en_caja: boolean;
  anulado_at: string | null;
  anulado_por_nombre: string | null;
  motivo_anulacion: string | null;
  items: ItemPedidoMostrador[];
};

/** GET /api/pedidos-mostrador */
export type ListaPedidosMostrador = {
  ahora: string;
  hoy: string;
  puede_ver_todos: boolean;
  puede_cobrar: boolean;
  todos: boolean;
  usuario_id: string;
  sucursal: { id: string; nombre: string } | null;
  deposito_id: string | null;
  pedidos: PedidoMostrador[];
};

/** GET /api/pedidos-mostrador/por-cobrar?caja=<id> */
export type PedidosPorCobrar = { ahora: string; caja_id?: string; pedidos: PedidoMostrador[] };

export const URL_PEDIDOS = "/api/pedidos-mostrador";
export const urlPedidosPorCobrar = (cajaId: string) => `/api/pedidos-mostrador/por-cobrar?caja=${cajaId}`;

/** Línea que se manda al guardar. */
export type LineaPedidoEnviar = { producto_id: string; cantidad: number; mods?: ModsSeleccion };

/** "P-0042" */
export const etiquetaPedido = (n: number) => `P-${String(n).padStart(4, "0")}`;
/** Lo que lleva el código de barras del comprobante (sin guion: todos los lectores lo tipean igual). */
export const codigoBarrasPedido = (n: number) => `P${String(n).padStart(4, "0")}`;

/**
 * ¿Lo escrito / escaneado es un número de pedido? "P-0042", "P0042", "p 42", "P'0042" (lector con
 * otra distribución de teclado) → 42. Un número solo NO (choca con códigos de producto).
 */
export function numeroDePedido(texto: string): number | null {
  const m = /^\s*p\s*[-'_/\s]?\s*0*(\d{1,7})\s*$/i.exec(texto);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
