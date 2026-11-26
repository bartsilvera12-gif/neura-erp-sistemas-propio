import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { editarProveedor, eliminarProveedor } from "@/lib/erp2/proveedores";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Proveedor no encontrado", 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return ok(await editarProveedor(c.pool, c.empresaId, id, b));
  } catch (err) {
    return fallo(err, "PATCH /proveedores/[id]");
  }
}

export async function DELETE(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Proveedor no encontrado", 404);
    return ok(await eliminarProveedor(c.pool, c.empresaId, id));
  } catch (err) {
    return fallo(err, "DELETE /proveedores/[id]");
  }
}
