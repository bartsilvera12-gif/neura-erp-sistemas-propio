import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { cerrarTurno, usrCaja } from "@/lib/erp2/caja";

export const runtime = "nodejs";

/** Cierre del turno con el arqueo (efectivo contado + lo declarado de cada forma de pago). */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos del cierre");
    return ok(await cerrarTurno(c.pool, usrCaja(c), b));
  } catch (err) {
    return fallo(err, "POST /caja/cierre");
  }
}
