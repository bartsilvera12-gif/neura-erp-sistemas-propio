import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { catalogos } from "@/lib/erp2/compras";

export const runtime = "nodejs";

/** Categorías de gasto (= cuentas de egresos del plan de cuentas), sucursal y cuenta de banco. */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, null);
    return ok(await catalogos(c.pool, c.empresaId));
  } catch (err) {
    return fallo(err, "GET /gastos/catalogos");
  }
}
