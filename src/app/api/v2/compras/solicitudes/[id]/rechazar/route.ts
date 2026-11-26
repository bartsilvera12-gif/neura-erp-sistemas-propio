import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { rechazarSolicitud } from "@/lib/erp2/ordenes";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

/** POST /api/v2/compras/solicitudes/[id]/rechazar — Alan rechaza con motivo (→ 'rechazada'). */
export async function POST(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Solicitud no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return ok(await rechazarSolicitud(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId }, id, String(b.motivo ?? "")));
  } catch (err) {
    return fallo(err, "POST /compras/solicitudes/[id]/rechazar");
  }
}
