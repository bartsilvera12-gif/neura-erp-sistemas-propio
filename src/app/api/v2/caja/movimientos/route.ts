import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { registrarMovimiento, usrCaja } from "@/lib/erp2/caja";

export const runtime = "nodejs";

/** Retiro o ingreso de efectivo en el turno abierto. */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos del movimiento");
    return ok(await registrarMovimiento(c.pool, usrCaja(c), b), 201);
  } catch (err) {
    return fallo(err, "POST /caja/movimientos");
  }
}
