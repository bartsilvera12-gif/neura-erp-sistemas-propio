/**
 * Coherencia de los precios de un producto (QA 18-nov-2026). La usan el formulario y la API (alta y
 * edición, sobre la fila resultante). Devuelve el problema o null.
 *   · mayorista y distribuidor no pueden ser más caros que el precio de venta (ni el distribuidor que el
 *     mayorista): son precios por cantidad, más baratos;
 *   · "desde cuántas unidades" del mayorista tiene que ser menor que el del distribuidor (vacío = 10 y 20).
 * Vender por debajo del costo NO se bloquea (liquidaciones): el formulario pide confirmación.
 */
export type PreciosProducto = {
  precio_venta?: number | null;
  precio_mayorista?: number | null;
  precio_distribuidor?: number | null;
  mayorista_desde?: number | null;
  distribuidor_desde?: number | null;
};

export const MAYORISTA_DESDE = 10;
export const DISTRIBUIDOR_DESDE = 20;

export function problemaPrecios(p: PreciosProducto): string | null {
  const venta = Number(p.precio_venta) || 0;
  const may = Number(p.precio_mayorista) || 0;
  const dis = Number(p.precio_distribuidor) || 0;
  if (may > 0 && venta > 0 && may > venta) return "El precio mayorista no puede ser mayor que el precio de venta.";
  if (dis > 0 && venta > 0 && dis > venta) return "El precio distribuidor no puede ser mayor que el precio de venta.";
  if (dis > 0 && may > 0 && dis > may) return "El precio distribuidor no puede ser mayor que el mayorista.";
  if (may > 0 && dis > 0) {
    const md = Number(p.mayorista_desde) || MAYORISTA_DESDE;
    const dd = Number(p.distribuidor_desde) || DISTRIBUIDOR_DESDE;
    if (md >= dd) return `El mayorista arranca en ${md} unidades y el distribuidor en ${dd}: el mayorista tiene que empezar antes.`;
  }
  return null;
}
