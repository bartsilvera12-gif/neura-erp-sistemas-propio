import { ctxV2, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, null);
    const { rows } = await c.pool.query(
      `SELECT id, nombre FROM neura.proveedor_categorias WHERE empresa_id = $1::uuid ORDER BY nombre`,
      [c.empresaId]
    ).catch(() => ({ rows: [] }));
    return ok({ categorias: rows });
  } catch (err) {
    return fallo(err, "GET /proveedores/categorias");
  }
}
