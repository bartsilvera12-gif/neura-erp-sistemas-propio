import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/** Historial de costos: cada compra de Neura que trajo este producto. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Producto no encontrado", 404);
    const { rows: p } = await c.pool.query(
      `SELECT COALESCE(costo_promedio, 0)::float AS costo FROM neura.productos WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [id, c.empresaId]
    );
    if (!p[0]) throw new ErrorV2("Producto no encontrado", 404);
    const { rows } = await c.pool.query(
      `SELECT x.* FROM (
         SELECT i.id, co.fecha, i.cantidad::float AS cantidad, i.costo_unitario::float AS costo,
                co.proveedor_nombre AS proveedor, co.proveedor_id, co.numero_comprobante AS factura,
                'compra' AS origen, co.numero_control AS referencia, co.usuario_nombre AS usuario
           FROM neura.compra_items i JOIN neura.compras co ON co.id = i.compra_id
          WHERE i.producto_id = $1::uuid AND co.empresa_id = $2::uuid AND co.estado IS DISTINCT FROM 'anulada'
         UNION ALL
         SELECT co.id, co.fecha, co.cantidad::float, co.costo_unitario::float, co.proveedor_nombre, co.proveedor_id,
                co.numero_comprobante, 'compra', co.numero_control, co.usuario_nombre
           FROM neura.compras co
          WHERE co.producto_id = $1::uuid AND co.empresa_id = $2::uuid AND co.estado IS DISTINCT FROM 'anulada'
            AND NOT EXISTS (SELECT 1 FROM neura.compra_items i WHERE i.compra_id = co.id)
       ) x ORDER BY x.fecha DESC LIMIT 100`,
      [id, c.empresaId]
    );
    const compras = rows.map((r, i) => {
      const previo = rows[i + 1]?.costo;
      return { ...r, variacion_pct: previo ? ((r.costo - previo) / previo) * 100 : null };
    });
    return ok({ costo_promedio: p[0].costo, total_compras: compras.length, compras });
  } catch (err) {
    return fallo(err, "GET /productos/[id]/costos");
  }
}
