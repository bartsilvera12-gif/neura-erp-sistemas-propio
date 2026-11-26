import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { anularVenta, usrCaja } from "@/lib/erp2/caja";

export const runtime = "nodejs";

/** Anula la venta (stock, cobros y su factura si todavía se puede). Solo administradores. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "ventas");
    if (!c.esAdmin) throw new ErrorV2("Solo un administrador anula ventas.", 403);
    const { id } = await params;
    const b = (await request.json().catch(() => ({}))) as { motivo?: string; caja_id?: string | null };
    return ok(await anularVenta(c.pool, usrCaja(c), id, String(b.motivo ?? ""), b.caja_id ?? null));
  } catch (err) {
    return fallo(err, "POST /ventas/[id]/anular");
  }
}
