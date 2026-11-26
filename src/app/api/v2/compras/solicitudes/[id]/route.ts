import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { detalleOrden } from "@/lib/erp2/ordenes";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

/** GET /api/v2/compras/solicitudes/[id] — detalle de una solicitud (reusa el de órdenes). */
export async function GET(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Solicitud no encontrada", 404);
    return ok(await detalleOrden(c.pool, c.empresaId, id));
  } catch (err) {
    return fallo(err, "GET /compras/solicitudes/[id]");
  }
}
