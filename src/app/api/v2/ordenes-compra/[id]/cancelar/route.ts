import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { cancelarOrden } from "@/lib/erp2/ordenes";
import { OrdenError } from "@/lib/ordenes/server/ordenes-pg";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Orden de compra no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as { motivo?: string };
    try {
      return ok(await cancelarOrden(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId }, id, String(b.motivo ?? "")));
    } catch (e) {
      if (e instanceof OrdenError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /ordenes-compra/[id]/cancelar");
  }
}
