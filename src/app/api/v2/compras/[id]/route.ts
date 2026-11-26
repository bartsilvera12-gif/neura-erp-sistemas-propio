import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { detalleCompra } from "@/lib/erp2/compras";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Compra no encontrada", 404);
    return ok(await detalleCompra(c.pool, c.empresaId, id));
  } catch (err) {
    return fallo(err, "GET /compras/[id]");
  }
}
