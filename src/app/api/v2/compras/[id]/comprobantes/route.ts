import { NextRequest } from "next/server";
import { POST as subirNeura } from "@/app/api/compras/[id]/comprobante/route";
import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string }> };

/** Neura guarda un comprobante por compra (`compras.documento_path`): la lista tiene 0 o 1. */
async function lista(pool: import("pg").Pool, empresaId: string, id: string) {
  const { rows } = await pool.query(
    `SELECT id, documento_path, documento_mime, usuario_nombre, updated_at FROM neura.compras WHERE id = $1::uuid AND empresa_id = $2::uuid`,
    [id, empresaId]
  );
  if (!rows[0]) throw new ErrorV2("Compra no encontrada", 404);
  const c = rows[0];
  return c.documento_path
    ? [{ id: c.id, compra_id: c.id, nombre: String(c.documento_path).split("/").pop(), mime: c.documento_mime, size: null, subido_por: c.usuario_nombre, created_at: c.updated_at }]
    : [];
}

export async function GET(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Compra no encontrada", 404);
    return ok({ comprobantes: await lista(c.pool, c.empresaId, id) });
  } catch (err) {
    return fallo(err, "GET /compras/[id]/comprobantes");
  }
}

/** Sube (o reemplaza) el comprobante con la ruta de siempre de Neura. */
export async function POST(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Compra no encontrada", 404);
    const res = await subirNeura(request as NextRequest, { params: Promise.resolve({ id }) });
    const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    if (!j?.success) throw new ErrorV2(j?.error ?? "No se pudo subir el comprobante");
    const [nuevo] = await lista(c.pool, c.empresaId, id);
    return ok(nuevo, 201);
  } catch (err) {
    return fallo(err, "POST /compras/[id]/comprobantes");
  }
}
