/**
 * Lista liviana de proveedores compartida por toda la app (selector, filtros de Compras
 * y Órdenes, alta de compra/orden): UNA sola llamada a /api/proveedores?min=1 aunque la
 * pidan varios componentes a la vez. Se renueva sola al minuto y se invalida al crear o
 * editar un proveedor (invalidarProveedores).
 */
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import type { ProveedorMin } from "@/erp2/modules/proveedores/tipos";

const TTL_MS = 60_000;
let cache: { promesa: Promise<ProveedorMin[]>; at: number } | null = null;

export function cargarProveedores(forzar = false): Promise<ProveedorMin[]> {
  if (!cache || forzar || Date.now() - cache.at > TTL_MS) {
    const promesa = apiFetch<{ proveedores: ProveedorMin[] }>("/api/proveedores?min=1")
      .then((r) => r.proveedores)
      .catch(() => {
        if (cache?.promesa === promesa) cache = null;
        return [] as ProveedorMin[];
      });
    cache = { promesa, at: Date.now() };
  }
  return cache.promesa;
}

/** Después de crear/editar/borrar un proveedor: la próxima carga va a la base. */
export function invalidarProveedores() {
  cache = null;
}
