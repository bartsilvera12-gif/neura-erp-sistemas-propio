/**
 * Lotes con vencimiento — tipos y ayudas compartidas (ficha del producto, pantalla
 * Vencimientos, compras y movimientos). No confundir con ./lote.ts (traer varios
 * productos en un request).
 */

export type LoteProducto = {
  id: string;
  numero: string;
  vencimiento: string; // YYYY-MM-DD
  cantidad: number;
  cantidad_inicial: number;
  costo_unitario: number;
  origen: "compra" | "ajuste_manual" | "traslado" | "ajuste" | "inventario_inicial";
  created_at: string;
  compra_numero: string | null;
  proveedor_nombre: string | null;
  deposito_id?: string;
  deposito_nombre?: string;
};

/** Stock de un producto por depósito (GET /api/productos/[id]/stock). */
export type StockDeposito = {
  deposito_id: string;
  deposito: string;
  sucursal_id: string;
  sucursal: string;
  es_principal: boolean;
  activo: boolean;
  cantidad: number;
  en_lotes: number;
  sin_lote: number;
  lotes: LoteProducto[];
};
export type StockProducto = {
  producto_id: string;
  stock_total: number;
  en_transito: number;
  controla_lotes: boolean;
  controla_stock: boolean;
  unidad_medida: string;
  hoy: string;
  depositos: StockDeposito[];
};

export type LotesDeProducto = {
  controla_lotes: boolean;
  stock_actual: number;
  en_lotes: number;
  /** stock − Σ lotes: > 0 unidades sin lote asignado (stock previo); < 0 faltante vendido sin lote */
  sin_lote: number;
  hoy: string;
  lotes: LoteProducto[];
};

export type FilaVencimiento = {
  lote_id: string;
  producto_id: string;
  producto: string;
  sku: string;
  unidad_medida: string;
  numero: string;
  vencimiento: string;
  dias: number;
  cantidad: number;
  costo: number;
  valor: number;
  estado: "vencido" | "por_vencer";
  deposito_id?: string;
  deposito?: string;
  sucursal?: string;
};

export type ReporteVencimientos = {
  hoy: string;
  dias: number;
  hay_productos_con_lotes: boolean;
  items: FilaVencimiento[];
  totales: {
    vencidos_unidades: number;
    vencidos_valor: number;
    vencidos_lotes: number;
    por_vencer_unidades: number;
    por_vencer_valor: number;
    por_vencer_lotes: number;
  };
};

/** Opciones del filtro "vencen en los próximos N días". */
export const OPCIONES_DIAS = [7, 15, 30, 60] as const;
const CLAVE_DIAS = "erp.vencimientos.dias";

/** Días de alerta elegidos en esta computadora (por defecto 30). */
export function diasAlerta(): number {
  try {
    const n = Number(localStorage.getItem(CLAVE_DIAS));
    return (OPCIONES_DIAS as readonly number[]).includes(n) ? n : 30;
  } catch {
    return 30;
  }
}
export function guardarDiasAlerta(n: number) {
  try {
    localStorage.setItem(CLAVE_DIAS, String(n));
  } catch {
    /* sin almacenamiento: queda el de por defecto */
  }
}

/** Días entre hoy y el vencimiento (negativo = vencido hace N días). Fechas YYYY-MM-DD. */
export function diasHasta(vencimiento: string, hoy: string): number {
  return Math.round((Date.parse(`${vencimiento}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}

export type EstadoLote = "vencido" | "por_vencer" | "ok";
export function estadoLote(dias: number, alerta: number): EstadoLote {
  return dias < 0 ? "vencido" : dias <= alerta ? "por_vencer" : "ok";
}

/** Clases y texto del estado: Vencido rojo · Vence pronto ámbar · OK. */
export function chipEstado(dias: number, alerta: number): { clase: string; texto: string } {
  const e = estadoLote(dias, alerta);
  if (e === "vencido") return { clase: "bg-rose-50 text-rose-700 ring-1 ring-rose-200", texto: "Vencido" };
  if (e === "por_vencer") return { clase: "bg-amber-50 text-amber-700 ring-1 ring-amber-200", texto: dias === 0 ? "Vence hoy" : "Vence pronto" };
  return { clase: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100", texto: "OK" };
}

/** "hace 3 días" · "hoy" · "en 5 días". */
export function textoDias(dias: number): string {
  if (dias === 0) return "hoy";
  if (dias === 1) return "mañana";
  if (dias === -1) return "ayer";
  return dias < 0 ? `hace ${Math.abs(dias)} días` : `en ${dias} días`;
}

/** 2026-10-13 → 13/10/2026 */
export function fechaCorta(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Lote automático que propone la pantalla (el mismo que usa la base si queda vacío). */
export function loteAutomatico(hoy: string): string {
  return `L-${hoy.slice(2, 4)}${hoy.slice(5, 7)}${hoy.slice(8, 10)}`;
}
