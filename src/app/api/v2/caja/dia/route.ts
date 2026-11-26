import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { totalesDia } from "@/lib/erp2/caja";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    return ok(await totalesDia(c.pool, c.empresaId));
  } catch (err) {
    return fallo(err, "GET /caja/dia");
  }
}
