import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { listarMovimientos } from "@/lib/erp2/inventario-docs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    return ok(await listarMovimientos(c.pool, c.empresaId, new URL(request.url).searchParams));
  } catch (err) {
    return fallo(err, "GET /inventario/movimientos");
  }
}
