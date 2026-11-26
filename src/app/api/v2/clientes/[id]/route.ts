import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { unCliente } from "@/lib/erp2/clientes";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "ventas");
    const { id } = await params;
    return ok({ cliente: await unCliente(c.pool, c.empresaId, id) });
  } catch (err) {
    return fallo(err, "GET /clientes/[id]");
  }
}
