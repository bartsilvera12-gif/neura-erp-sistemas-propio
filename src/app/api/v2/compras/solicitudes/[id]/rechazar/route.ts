import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { rechazarSolicitud } from "@/lib/erp2/ordenes";
import { notificarFlujoCompra } from "@/lib/compras/solicitud-notificar";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

/** POST /api/v2/compras/solicitudes/[id]/rechazar — Alan rechaza con motivo (→ 'rechazada'). */
export async function POST(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Solicitud no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo = String(b.motivo ?? "");
    const r = await rechazarSolicitud(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId }, id, motivo);
    await notificarFlujoCompra(c.empresaId, { evento: "rechazada", ordenId: id, actorId: c.usuarioId, motivo });
    return ok(r);
  } catch (err) {
    return fallo(err, "POST /compras/solicitudes/[id]/rechazar");
  }
}
