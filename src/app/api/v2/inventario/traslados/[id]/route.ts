import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { detalleTraslado } from "@/lib/erp2/inventario-docs";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Traslado no encontrado", 404);
    return ok(await detalleTraslado(c.pool, c.empresaId, id, "Neura"));
  } catch (err) {
    return fallo(err, "GET /inventario/traslados/[id]");
  }
}
