import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

const COLS = "id, nombre, codigo, descripcion, parent_id, COALESCE(activo, true) AS activo, NULL::text AS color, created_at";

function slug(nombre: string) {
  const s = nombre.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return s || "categoria";
}

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const { rows } = await c.pool.query(
      `SELECT ${COLS} FROM neura.categorias_productos WHERE empresa_id = $1::uuid ORDER BY nombre`,
      [c.empresaId]
    );
    return ok({ categorias: rows });
  } catch (err) {
    return fallo(err, "GET /inventario/categorias");
  }
}

/** Alta rápida desde el formulario de producto (nombre y, opcional, la categoría madre). */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const b = (await request.json().catch(() => ({}))) as { nombre?: string; parent_id?: string | null };
    const nombre = String(b.nombre ?? "").trim().slice(0, 120);
    if (!nombre) throw new ErrorV2("Escribí el nombre de la categoría");
    const parent = esUuid(b.parent_id) ? b.parent_id : null;
    const { rows } = await c.pool.query(
      `INSERT INTO neura.categorias_productos (empresa_id, nombre, codigo, parent_id, activo)
       VALUES ($1::uuid, $2, $3, $4::uuid, true)
       RETURNING ${COLS}`,
      [c.empresaId, nombre, slug(nombre), parent]
    );
    return ok({ categoria: rows[0] }, 201);
  } catch (err) {
    return fallo(err, "POST /inventario/categorias");
  }
}
