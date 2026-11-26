import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Traslado no encontrado", 404);
    const b = (await request.json().catch(() => ({}))) as { items?: { item_id: string; cantidad_recibida: number }[]; diferencia_motivo?: string };
    const p = {
      items: Array.isArray(b.items) ? b.items.map((x) => ({ item_id: x.item_id, cantidad_recibida: x.cantidad_recibida })) : [],
      diferencia_motivo: b.diferencia_motivo ?? "",
    };
    const { rows } = await c.pool.query(`SELECT neura.inv_recibir_traslado($1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb) AS r`, [
      c.empresaId,
      c.usuarioId,
      c.nombre,
      id,
      JSON.stringify(p),
    ]);
    return ok(rows[0].r);
  } catch (err) {
    return fallo(err, "POST /inventario/traslados/[id]/recibir");
  }
}
