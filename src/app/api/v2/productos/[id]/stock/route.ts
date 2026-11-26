import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/** Stock del producto en cada depósito (Neura no maneja lotes: van vacíos). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Producto no encontrado", 404);
    const { rows: p } = await c.pool.query(
      `SELECT COALESCE(stock_actual, 0)::float AS stock_total, COALESCE(NULLIF(unidad_medida, ''), 'Unidad') AS unidad_medida
         FROM neura.productos WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, c.empresaId]
    );
    if (!p[0]) throw new ErrorV2("Producto no encontrado", 404);
    const { rows: deps } = await c.pool.query(
      `SELECT u.id AS deposito_id, u.nombre AS deposito, $2::uuid AS sucursal_id, 'Casa central' AS sucursal,
              u.es_predeterminado AS es_principal, COALESCE(u.activo, true) AS activo,
              COALESCE(s.stock_actual, 0)::float AS cantidad
         FROM neura.inventario_ubicaciones u
         LEFT JOIN neura.inventario_stock_ubicacion s ON s.ubicacion_id = u.id AND s.producto_id = $1::uuid
        WHERE u.empresa_id = $2::uuid AND (COALESCE(u.activo, true) OR COALESCE(s.stock_actual, 0) <> 0)
        ORDER BY u.es_predeterminado DESC, u.nombre`,
      [id, c.empresaId]
    );
    const { rows: tr } = await c.pool.query(
      `SELECT COALESCE(SUM(i.cantidad), 0)::float AS n FROM neura.inventario_traslados_items i
         JOIN neura.inventario_traslados t ON t.id = i.traslado_id
        WHERE i.producto_id = $1::uuid AND t.estado = 'en_transito'`,
      [id]
    );
    return ok({
      producto_id: id,
      stock_total: p[0].stock_total,
      en_transito: tr[0]?.n ?? 0,
      controla_lotes: false,
      controla_stock: true,
      unidad_medida: p[0].unidad_medida,
      hoy: new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" }),
      depositos: deps.map((d) => ({ ...d, en_lotes: 0, sin_lote: d.cantidad, lotes: [] })),
    });
  } catch (err) {
    return fallo(err, "GET /productos/[id]/stock");
  }
}
