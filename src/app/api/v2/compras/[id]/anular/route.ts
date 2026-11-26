import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";
import { anularCompra } from "@/lib/erp2/compras";
import { actualizarEstadoOrden } from "@/lib/erp2/ordenes";

export const runtime = "nodejs";

/** Anula la compra (stock y asiento inversos). Ver `anularCompra`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Compra no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as { motivo?: string };
    const motivo = String(b.motivo ?? "").trim();
    if (!motivo) throw new ErrorV2("Escribí el motivo de la anulación");
    try {
      const r = await anularCompra(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre }, id, motivo);
      const { rows } = await c.pool.query(`SELECT orden_compra_id FROM neura.compras WHERE id = $1::uuid`, [id]);
      if (rows[0]?.orden_compra_id) await actualizarEstadoOrden(c.pool, c.empresaId, rows[0].orden_compra_id).catch(() => {});
      return ok(r);
    } catch (e) {
      if (e instanceof ContabilidadError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /compras/[id]/anular");
  }
}
