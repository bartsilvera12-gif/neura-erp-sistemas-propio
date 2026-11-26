"use client";

/**
 * Ficha del producto (panel lateral de Inventario): sus secciones que se piden aparte
 * (historial de costos, stock por depósito con sus lotes) van por el cache de listas, así:
 *   · al pasar el mouse por "editar" ya se piden (y se baja el JS del panel)
 *   · volver a abrir el mismo producto pinta al instante y se refresca en segundo plano
 */
import { precargarLista } from "@/erp2/modules/inventario/lista-cache";

export const urlCostos = (productoId: string) => `/api/productos/${productoId}/costos`;
export const urlStock = (productoId: string) => `/api/productos/${productoId}/stock`;
/** Costo por compra (capas PEPS, receta 79). agotadas: también las capas ya vendidas. */
export const urlCapas = (productoId: string, agotadas = false) => `/api/productos/${productoId}/capas${agotadas ? "?agotadas=1" : ""}`;

/** Precarga lo que va a pedir la ficha de este producto (sin esperar ni avisar errores). */
export function precargarFichaProducto(p: { id: string; controla_stock?: boolean }) {
  precargarLista(urlCostos(p.id));
  if (p.controla_stock !== false) precargarLista(urlStock(p.id));
}
