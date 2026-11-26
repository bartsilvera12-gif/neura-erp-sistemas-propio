/**
 * Cliente de /api/productos/lote: trae el detalle (y si se pide, el historial de costos)
 * de varios productos en 1 request por cada 150 ids, en vez de uno por producto.
 */
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import type { HistorialCostosData } from "@/erp2/modules/inventario/HistorialCostos";

// 150 uuids ≈ 5,5 KB de URL: lejos del límite de la API (la ruta acepta hasta 200).
const POR_REQUEST = 150;

export async function traerProductosLote<P extends { id: string }>(
  ids: string[],
  opts: { costos?: boolean; costosLimite?: number } = {},
): Promise<{ productos: Map<string, P>; costos: Map<string, HistorialCostosData | null> }> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const productos = new Map<string, P>();
  const costos = new Map<string, HistorialCostosData | null>();
  const tandas: string[][] = [];
  for (let i = 0; i < unicos.length; i += POR_REQUEST) tandas.push(unicos.slice(i, i + POR_REQUEST));
  const res = await Promise.all(
    tandas.map((t) => {
      const sp = new URLSearchParams({ ids: t.join(",") });
      if (opts.costos) sp.set("costos", "1");
      if (opts.costos && opts.costosLimite) sp.set("costos_limite", String(opts.costosLimite));
      return apiFetch<{ productos: P[]; costos?: Record<string, HistorialCostosData | null> }>(`/api/productos/lote?${sp}`);
    }),
  );
  for (const r of res) {
    for (const p of r.productos ?? []) productos.set(p.id, p);
    for (const [id, h] of Object.entries(r.costos ?? {})) costos.set(id, h);
  }
  return { productos, costos };
}
