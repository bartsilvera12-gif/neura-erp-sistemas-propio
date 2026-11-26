import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { estadoCajas, guardarPunto, usrCaja } from "@/lib/erp2/caja";

export const runtime = "nodejs";

/** GET → estado de todas las cajas (turnos abiertos, últimos cierres). POST → alta / edición de una caja. */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    return ok(await estadoCajas(c.pool, usrCaja(c)));
  } catch (err) {
    return fallo(err, "GET /caja/cajas");
  }
}

export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos de la caja");
    return ok(await guardarPunto(c.pool, usrCaja(c), b));
  } catch (err) {
    return fallo(err, "POST /caja/cajas");
  }
}
