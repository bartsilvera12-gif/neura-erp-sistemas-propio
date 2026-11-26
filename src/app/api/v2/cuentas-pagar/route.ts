import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { listarCuentasPagar } from "@/lib/erp2/pagos";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    return ok(await listarCuentasPagar(c.pool, c.empresaId, new URL(request.url).searchParams));
  } catch (err) {
    return fallo(err, "GET /cuentas-pagar");
  }
}
