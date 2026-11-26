import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { detalleOrden, editarOrden } from "@/lib/erp2/ordenes";
import { OrdenError } from "@/lib/ordenes/server/ordenes-pg";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Orden de compra no encontrada", 404);
    return ok(await detalleOrden(c.pool, c.empresaId, id));
  } catch (err) {
    return fallo(err, "GET /ordenes-compra/[id]");
  }
}

export async function PATCH(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Orden de compra no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return ok(await editarOrden(c.pool, c.empresaId, id, b));
    } catch (e) {
      if (e instanceof OrdenError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "PATCH /ordenes-compra/[id]");
  }
}
