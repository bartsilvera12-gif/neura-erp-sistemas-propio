import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { crearVenta, usrCaja, type VentaInput } from "@/lib/erp2/caja";

export const runtime = "nodejs";

/**
 * Venta del POS. Con factura: crea la factura de Neura (se emite a SIFEN desde Facturas) y, al
 * contado, su cobro. Ver `crearVenta`.
 */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    const b = (await request.json().catch(() => null)) as VentaInput | null;
    if (!b) throw new ErrorV2("Faltan los datos de la venta");
    return ok(await crearVenta(c.pool, usrCaja(c), b), 201);
  } catch (err) {
    return fallo(err, "POST /caja/venta");
  }
}
