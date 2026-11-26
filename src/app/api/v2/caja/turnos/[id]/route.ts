import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { resumenTurno, usrCaja } from "@/lib/erp2/caja";

export const runtime = "nodejs";

/** Resumen del turno: arqueo por forma de pago, ventas, movimientos. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "ventas");
    const { id } = await params;
    return ok(await resumenTurno(c.pool, usrCaja(c), id));
  } catch (err) {
    return fallo(err, "GET /caja/turnos/[id]");
  }
}
