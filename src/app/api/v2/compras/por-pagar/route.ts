import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { listarPorPagar } from "@/lib/erp2/ordenes";

export const runtime = "nodejs";

/**
 * GET /api/v2/compras/por-pagar
 * Bandeja de pago (Guillermo): órdenes firmes con pago pendiente por defecto.
 * `?pago=confirmado` ya pagadas · `?pago=` todas.
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const sp = new URL(request.url).searchParams;
    return ok(await listarPorPagar(c.pool, c.empresaId, sp));
  } catch (err) {
    return fallo(err, "GET /compras/por-pagar");
  }
}
