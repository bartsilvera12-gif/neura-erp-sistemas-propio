import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { estadoCuenta } from "@/lib/erp2/pagos";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Proveedor no encontrado", 404);
    return ok(await estadoCuenta(c.pool, c.empresaId, id));
  } catch (err) {
    return fallo(err, "GET /proveedores/[id]/estado-cuenta");
  }
}
