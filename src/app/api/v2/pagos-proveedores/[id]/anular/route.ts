import { ctxV2, ErrorV2, esUuid, fallo, ok } from "@/lib/erp2/server";
import { anularPago } from "@/lib/erp2/pagos";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "compras");
    const { id } = await params;
    if (!esUuid(id)) throw new ErrorV2("Pago no encontrado", 404);
    const b = (await request.json().catch(() => ({}))) as { motivo?: string };
    try {
      return ok(await anularPago(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre }, id, String(b.motivo ?? "")));
    } catch (e) {
      if (e instanceof ContabilidadError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /pagos-proveedores/[id]/anular");
  }
}
