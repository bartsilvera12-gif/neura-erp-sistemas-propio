import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { guardarRolCompra, listarRolesCompra } from "@/lib/erp2/compras-roles";

export const runtime = "nodejs";

/** GET /api/v2/compras/roles — usuarios de la empresa con sus roles del flujo (solo admin). */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    if (!c.esAdmin) throw new ErrorV2("Solo un administrador puede ver los roles de compra.", 403);
    return ok(await listarRolesCompra(c.pool, c.empresaId));
  } catch (err) {
    return fallo(err, "GET /compras/roles");
  }
}

/** PUT /api/v2/compras/roles — define los roles (confirma/paga/recibe) de un usuario (solo admin). */
export async function PUT(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    if (!c.esAdmin) throw new ErrorV2("Solo un administrador puede cambiar los roles de compra.", 403);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!esUuid(b.usuario_id)) throw new ErrorV2("Usuario inválido");
    return ok(
      await guardarRolCompra(c.pool, c.empresaId, b.usuario_id as string, {
        confirma: !!b.confirma,
        paga: !!b.paga,
        recibe: !!b.recibe,
      })
    );
  } catch (err) {
    return fallo(err, "PUT /compras/roles");
  }
}
