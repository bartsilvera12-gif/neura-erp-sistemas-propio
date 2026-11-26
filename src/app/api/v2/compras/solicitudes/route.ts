import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { crearSolicitud, listarOrdenes } from "@/lib/erp2/ordenes";
import { OrdenError } from "@/lib/ordenes/server/ordenes-pg";

export const runtime = "nodejs";

/**
 * GET /api/v2/compras/solicitudes
 * Bandeja de solicitudes de compra (órdenes en estado 'solicitada' por defecto).
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const sp = new URL(request.url).searchParams;
    if (!sp.get("estado")) sp.set("estado", "solicitada");
    return ok(await listarOrdenes(c.pool, c.empresaId, sp));
  } catch (err) {
    return fallo(err, "GET /compras/solicitudes");
  }
}

/**
 * POST /api/v2/compras/solicitudes
 * Comercial crea una solicitud de compra (no se auto-aprueba).
 */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos de la solicitud");
    try {
      return ok(await crearSolicitud(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre }, b), 201);
    } catch (e) {
      if (e instanceof OrdenError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /compras/solicitudes");
  }
}
