import type { OrdenItemInput, IvaTipo } from "@/lib/ordenes/server/ordenes-pg";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const str = (v: unknown) => (v == null ? "" : String(v).trim());

/** Normaliza los ítems de una orden desde el payload (no confía en el frontend). */
export function parseOrdenItems(raw: unknown): OrdenItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const iva = str(o.iva_tipo);
    return {
      producto_id: UUID_RE.test(str(o.producto_id)) ? str(o.producto_id) : null,
      producto_nombre: str(o.producto_nombre),
      descripcion: str(o.descripcion) || null,
      cantidad: Number(o.cantidad) || 0,
      costo_unitario_estimado: Number(o.costo_unitario_estimado) || 0,
      iva_tipo: (["exenta", "5", "10"].includes(iva) ? iva : "10") as IvaTipo,
      cuenta_contable_id: UUID_RE.test(str(o.cuenta_contable_id)) ? str(o.cuenta_contable_id) : null,
    };
  });
}
