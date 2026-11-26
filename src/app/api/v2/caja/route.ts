import { ctxV2, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/**
 * Hasta que Caja del 2.0 esté en Neura no hay turnos: el pago en efectivo de una compra sale
 * de la cuenta Caja de la configuración contable, como siempre en Neura.
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, null);
    return ok({ caja: { id: c.empresaId, nombre: "Caja" } });
  } catch (err) {
    return fallo(err, "GET /caja");
  }
}
