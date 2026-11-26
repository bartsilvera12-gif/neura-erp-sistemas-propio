import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { listarCompras } from "@/lib/erp2/compras";

export const runtime = "nodejs";

/** Lista de compras (Neura no mezcla acá los gastos: siguen en Gastos y Servicios). */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    return ok(await listarCompras(c.pool, c.empresaId, new URL(request.url).searchParams));
  } catch (err) {
    return fallo(err, "GET /compras-gastos");
  }
}
