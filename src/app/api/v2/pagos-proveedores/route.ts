import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { listarPagos, registrarPago } from "@/lib/erp2/pagos";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    return ok(await listarPagos(c.pool, c.empresaId, new URL(request.url).searchParams));
  } catch (err) {
    return fallo(err, "GET /pagos-proveedores");
  }
}

/** Registra el pago con su asiento contable (Proveedores al Debe, Caja/Banco al Haber). */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos del pago");
    try {
      return ok(await registrarPago(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre }, b), 201);
    } catch (e) {
      if (e instanceof ContabilidadError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /pagos-proveedores");
  }
}
