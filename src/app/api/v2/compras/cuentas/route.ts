import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { cuentasCompra } from "@/lib/erp2/compras";

export const runtime = "nodejs";

/** Cuentas contables para la mercadería de una compra (el campo que Neura suma a la pantalla del 2.0). */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    return ok({ cuentas: await cuentasCompra(c.pool, c.empresaId) });
  } catch (err) {
    return fallo(err, "GET /compras/cuentas");
  }
}
