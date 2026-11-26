import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { crearCompra } from "@/lib/erp2/compras";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

export const runtime = "nodejs";

/** Alta de compra: va por la compra multilínea de Neura (stock + asiento contable, en una transacción). */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos de la compra");
    try {
      return ok(await crearCompra(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre }, b), 201);
    } catch (e) {
      if (e instanceof ContabilidadError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /compras");
  }
}
