import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { confirmarSolicitud } from "@/lib/erp2/ordenes";
import { OrdenError } from "@/lib/ordenes/server/ordenes-pg";
import { notificarFlujoCompra } from "@/lib/compras/solicitud-notificar";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/compras/solicitudes/[id]/confirmar
 * Alan confirma la solicitud (opcionalmente con líneas ajustadas): pasa a 'aprobada'.
 */
export async function POST(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Solicitud no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const r = await confirmarSolicitud(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId }, id, b);
      await notificarFlujoCompra(c.empresaId, { evento: "confirmada", ordenId: id, actorId: c.usuarioId });
      return ok(r);
    } catch (e) {
      if (e instanceof OrdenError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /compras/solicitudes/[id]/confirmar");
  }
}
