import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { miBandejaCompra } from "@/lib/erp2/ordenes";
import { destinatariosFlujo } from "@/lib/erp2/compras-roles";

export const runtime = "nodejs";

/**
 * GET /api/v2/compras/mi-bandeja
 * Secciones del flujo que le tocan al usuario según su rol (con fallback a admins).
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const dest = await destinatariosFlujo(c.empresaId);
    const roles = {
      confirma: dest.confirma.includes(c.usuarioId),
      paga: dest.paga.includes(c.usuarioId),
      recibe: dest.recibe.includes(c.usuarioId),
    };
    const secciones = await miBandejaCompra(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId }, roles);
    return ok({ roles, ...secciones });
  } catch (err) {
    return fallo(err, "GET /compras/mi-bandeja");
  }
}
