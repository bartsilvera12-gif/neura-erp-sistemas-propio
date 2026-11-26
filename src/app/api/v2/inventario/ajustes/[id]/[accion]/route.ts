import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/** anular: devuelve cada diferencia al depósito. En Neura no hay aprobaciones (todo se aplica al cargar). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; accion: string }> }) {
  try {
    const c = await ctxV2(request, "inventario");
    const { id, accion } = await params;
    if (!esUuid(id)) throw new ErrorV2("Documento no encontrado", 404);
    if (accion !== "anular") throw new ErrorV2("En Neura los ajustes se aplican al cargarlos: no hay nada que aprobar.");
    const b = (await request.json().catch(() => ({}))) as { motivo?: string };
    const { rows } = await c.pool.query(`SELECT neura.inv_anular_ajuste($1::uuid, $2::uuid, $3, $4::uuid, $5) AS r`, [
      c.empresaId,
      c.usuarioId,
      c.nombre,
      id,
      String(b.motivo ?? ""),
    ]);
    return ok(rows[0].r);
  } catch (err) {
    return fallo(err, "POST /inventario/ajustes/[id]/[accion]");
  }
}
