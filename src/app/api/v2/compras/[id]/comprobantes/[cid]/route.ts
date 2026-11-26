import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { COMPRAS_COMPROBANTES_BUCKET, signComprobante } from "@/lib/compras/comprobante-storage";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const runtime = "nodejs";
type P = { params: Promise<{ id: string; cid: string }> };

async function documento(pool: import("pg").Pool, empresaId: string, id: string) {
  const { rows } = await pool.query(`SELECT documento_path FROM neura.compras WHERE id = $1::uuid AND empresa_id = $2::uuid`, [id, empresaId]);
  if (!rows[0]?.documento_path) throw new ErrorV2("Comprobante no encontrado", 404);
  return rows[0].documento_path as string;
}

/** Enlace firmado para ver el comprobante. */
export async function GET(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Comprobante no encontrado", 404);
    const url = await signComprobante(createServiceRoleClient() as unknown as AppSupabaseClient, await documento(c.pool, c.empresaId, id), 3600);
    if (!url) throw new ErrorV2("No se pudo abrir el comprobante");
    return ok({ url });
  } catch (err) {
    return fallo(err, "GET /compras/[id]/comprobantes/[cid]");
  }
}

/** Quita el comprobante de la compra. */
export async function DELETE(request: Request, { params }: P) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Comprobante no encontrado", 404);
    const path = await documento(c.pool, c.empresaId, id);
    await c.pool.query(`UPDATE neura.compras SET documento_path = NULL, documento_mime = NULL, updated_at = now() WHERE id = $1::uuid`, [id]);
    await (createServiceRoleClient() as unknown as AppSupabaseClient).storage.from(COMPRAS_COMPROBANTES_BUCKET).remove([path]);
    return ok({ id });
  } catch (err) {
    return fallo(err, "DELETE /compras/[id]/comprobantes/[cid]");
  }
}
