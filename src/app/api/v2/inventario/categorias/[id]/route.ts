import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

/** Editar una categoría (nombre, código, descripción, madre, activa). El color no se guarda en Neura. */
export async function PATCH(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Categoría no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.parent_id === id) throw new ErrorV2("Una categoría no puede estar dentro de sí misma.");
    if (esUuid(b.parent_id)) {
      const [{ rows: pa }, { rows: hijas }] = await Promise.all([
        c.pool.query(`SELECT parent_id FROM neura.categorias_productos WHERE id = $1::uuid AND empresa_id = $2::uuid`, [b.parent_id, c.empresaId]),
        c.pool.query(`SELECT 1 FROM neura.categorias_productos WHERE parent_id = $1::uuid LIMIT 1`, [id]),
      ]);
      if (!pa[0]) throw new ErrorV2("La categoría elegida no existe.");
      if (pa[0].parent_id) throw new ErrorV2("Las subcategorías no pueden tener otras subcategorías adentro.");
      if (hijas.length) throw new ErrorV2("Esta categoría tiene subcategorías: no puede quedar dentro de otra.");
    }
    const set: string[] = [];
    const args: unknown[] = [id, c.empresaId];
    const poner = (col: string, v: unknown, cast = "") => {
      args.push(v);
      set.push(`${col} = $${args.length}${cast}`);
    };
    if (typeof b.nombre === "string") {
      if (!b.nombre.trim()) throw new ErrorV2("El nombre es obligatorio.");
      poner("nombre", b.nombre.trim().slice(0, 120));
    }
    if (b.codigo !== undefined) poner("codigo", typeof b.codigo === "string" && b.codigo.trim() ? b.codigo.trim().toUpperCase().slice(0, 60) : null);
    if (b.descripcion !== undefined) poner("descripcion", typeof b.descripcion === "string" && b.descripcion.trim() ? b.descripcion.trim().slice(0, 500) : null);
    if (b.parent_id !== undefined) poner("parent_id", esUuid(b.parent_id) ? b.parent_id : null, "::uuid");
    if (typeof b.activo === "boolean") poner("activo", b.activo);
    if (set.length) {
      const { rowCount } = await c.pool.query(
        `UPDATE neura.categorias_productos SET ${set.join(", ")}, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        args
      );
      if (!rowCount) throw new ErrorV2("Categoría no encontrada", 404);
    }
    return ok({ id });
  } catch (err) {
    return fallo(err, "PATCH /inventario/categorias/[id]");
  }
}

/** Eliminar: solo si no tiene productos ni subcategorías. */
export async function DELETE(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Categoría no encontrada", 404);
    const { rows } = await c.pool.query(
      `SELECT (SELECT count(*) FROM neura.productos WHERE categoria_principal_id = $1::uuid)::int AS productos,
              (SELECT count(*) FROM neura.producto_categorias WHERE categoria_id = $1::uuid)::int AS asignados,
              (SELECT count(*) FROM neura.categorias_productos WHERE parent_id = $1::uuid)::int AS hijas`,
      [id]
    );
    const usados = Math.max(rows[0].productos, rows[0].asignados);
    if (usados > 0) throw new ErrorV2(`No se puede eliminar: tiene ${usados} producto(s). Desactivala o mové los productos.`);
    if (rows[0].hijas > 0) throw new ErrorV2("No se puede eliminar: tiene subcategorías.");
    const { rowCount } = await c.pool.query(`DELETE FROM neura.categorias_productos WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, c.empresaId]);
    if (!rowCount) throw new ErrorV2("Categoría no encontrada", 404);
    return ok({ id });
  } catch (err) {
    return fallo(err, "DELETE /inventario/categorias/[id]");
  }
}
