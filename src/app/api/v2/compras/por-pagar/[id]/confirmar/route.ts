import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { confirmarPago } from "@/lib/erp2/ordenes";
import { notificarFlujoCompra } from "@/lib/compras/solicitud-notificar";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

/** POST /api/v2/compras/por-pagar/[id]/confirmar — Guillermo confirma el pago (método/referencia opcionales). */
export async function POST(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Orden no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await confirmarPago(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId }, id, b);
    await notificarFlujoCompra(c.empresaId, { evento: "pagada", ordenId: id, actorId: c.usuarioId });
    return ok(r);
  } catch (err) {
    return fallo(err, "POST /compras/por-pagar/[id]/confirmar");
  }
}
