import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/** Costo por depósito. Neura valúa a costo promedio (sin capas PEPS): una sola "capa" por depósito. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Producto no encontrado", 404);
    const { rows: p } = await c.pool.query(
      `SELECT COALESCE(costo_promedio, 0)::float AS costo, COALESCE(stock_actual, 0)::float AS stock
         FROM neura.productos WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, c.empresaId]
    );
    if (!p[0]) throw new ErrorV2("Producto no encontrado", 404);
    const { rows } = await c.pool.query(
      `SELECT u.id AS deposito_id, u.nombre AS deposito, s.stock_actual::float AS unidades
         FROM neura.inventario_stock_ubicacion s JOIN neura.inventario_ubicaciones u ON u.id = s.ubicacion_id
        WHERE s.producto_id = $1::uuid AND s.stock_actual > 0
        ORDER BY u.es_predeterminado DESC, u.nombre`,
      [id]
    );
    const costo = p[0].costo;
    const depositos = rows.map((r) => ({ ...r, valor: r.unidades * costo, costo_proxima: costo }));
    const unidades = depositos.reduce((a, d) => a + d.unidades, 0);
    return ok({
      controla_lotes: false,
      costo_promedio: costo,
      stock_total: p[0].stock,
      resumen: { unidades, valor: unidades * costo, costo_proxima: unidades > 0 ? costo : null, deposito_proxima: depositos[0]?.deposito ?? null },
      depositos,
      capas: [],
      agotadas: 0,
      faltante: 0,
      descuadre: 0,
    });
  } catch (err) {
    return fallo(err, "GET /productos/[id]/capas");
  }
}
