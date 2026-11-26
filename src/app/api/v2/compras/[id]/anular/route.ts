import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";
import { anularCompra } from "@/lib/erp2/compras";

export const runtime = "nodejs";

/** Anula la compra (stock y asiento inversos). Ver `anularCompra`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Compra no encontrada", 404);
    const b = (await request.json().catch(() => ({}))) as { motivo?: string };
    const motivo = String(b.motivo ?? "").trim();
    if (!motivo) throw new ErrorV2("Escribí el motivo de la anulación");
    try {
      return ok(await anularCompra(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre }, id, motivo));
    } catch (e) {
      if (e instanceof ContabilidadError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /compras/[id]/anular");
  }
}
