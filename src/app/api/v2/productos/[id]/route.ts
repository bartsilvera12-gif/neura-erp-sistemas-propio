import { ctxV2, enTransaccion, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { camposProducto, eliminarProducto, unProducto } from "@/lib/erp2/productos";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Producto no encontrado", 404);
    return ok(await unProducto(c.pool, c.empresaId, id));
  } catch (err) {
    return fallo(err, "GET /productos/[id]");
  }
}

/** Editar datos o activar/desactivar. El stock no se toca acá (va por ajustes). */
export async function PATCH(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Producto no encontrado", 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const campos = camposProducto(b, false);
    const cols = Object.keys(campos);
    if (cols.length > 0) {
      const { rowCount } = await c.pool.query(
        `UPDATE neura.productos SET ${cols.map((k, i) => `${k} = $${i + 3}`).join(", ")}, updated_at = now()
          WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [id, c.empresaId, ...Object.values(campos)]
      );
      if (!rowCount) throw new ErrorV2("Producto no encontrado", 404);
    }
    return ok({ id });
  } catch (err) {
    return fallo(err, "PATCH /productos/[id]");
  }
}

/** Eliminar: solo si nunca se usó (si no, se pide desactivarlo). */
export async function DELETE(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Producto no encontrado", 404);
    await enTransaccion(c.pool, (t) => eliminarProducto(t, c.empresaId, id));
    return ok({ id });
  } catch (err) {
    return fallo(err, "DELETE /productos/[id]");
  }
}
