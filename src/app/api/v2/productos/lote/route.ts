import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { COLS } from "@/lib/erp2/productos";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { signProductoImagen } from "@/lib/inventario/imagen-storage";

export const runtime = "nodejs";

/**
 * GET /api/v2/productos/lote?ids=a,b,c&costos=1&costos_limite=1
 * Detalle de varios productos por id (con stock por depósito e imagen firmada) y,
 * si se pide, el historial de costos (últimas compras). Lo usa "Recibir orden"
 * para precargar las líneas del pedido; sin esta ruta la recepción no auto-carga
 * los productos (404).
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const sp = new URL(request.url).searchParams;
    const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
    if (ids.length === 0) return ok({ productos: [], costos: {} });

    const { rows } = await c.pool.query(
      `SELECT ${COLS},
              COALESCE((SELECT json_agg(json_build_object('d', s.ubicacion_id, 'c', s.stock_actual::float))
                          FROM neura.inventario_stock_ubicacion s
                         WHERE s.producto_id = p.id AND s.empresa_id = p.empresa_id AND s.stock_actual <> 0), '[]') AS stock_depositos
         FROM neura.productos p
        WHERE p.empresa_id = $1::uuid AND p.id = ANY($2::uuid[])`,
      [c.empresaId, ids]
    );

    // Firmar la imagen del bucket privado (best-effort) para que se vea la miniatura.
    const sb = createServiceRoleClient() as Parameters<typeof signProductoImagen>[0];
    const productos = await Promise.all(
      (rows as Array<{ imagen_url?: string | null; imagen_path?: string | null }>).map(async (r) => {
        if (r.imagen_url || !r.imagen_path) return r;
        const url = await signProductoImagen(sb, r.imagen_path, 3600).catch(() => null);
        return url ? { ...r, imagen_url: url } : r;
      })
    );

    // Historial de costos (últimas compras por producto), opcional.
    const costos: Record<string, { compras: { costo: number; fecha: string; proveedor: string | null }[] } | null> = {};
    if (sp.get("costos") === "1") {
      try {
        const limite = Math.max(1, Math.min(10, Number(sp.get("costos_limite")) || 1));
        const { rows: cr } = await c.pool.query<{ producto_id: string; costo: number; fecha: string; proveedor: string | null }>(
          `SELECT ci.producto_id, ci.costo_unitario::float AS costo, c.fecha, c.proveedor_nombre AS proveedor
             FROM neura.compra_items ci JOIN neura.compras c ON c.id = ci.compra_id
            WHERE c.empresa_id = $1::uuid AND ci.producto_id = ANY($2::uuid[]) AND COALESCE(c.estado, '') <> 'anulada'
            ORDER BY c.fecha DESC, c.created_at DESC`,
          [c.empresaId, ids]
        );
        for (const id of ids) {
          const compras = cr.filter((r) => r.producto_id === id).slice(0, limite)
            .map((r) => ({ costo: Number(r.costo), fecha: r.fecha, proveedor: r.proveedor }));
          costos[id] = compras.length ? { compras } : null;
        }
      } catch {
        /* el historial es opcional: si falla, los productos igual se devuelven */
      }
    }

    return ok({ productos, costos });
  } catch (err) {
    return fallo(err, "GET /productos/lote");
  }
}
