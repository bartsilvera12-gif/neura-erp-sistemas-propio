import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { crearOrden, listarOrdenes } from "@/lib/erp2/ordenes";
import { OrdenError } from "@/lib/ordenes/server/ordenes-pg";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    return ok(await listarOrdenes(c.pool, c.empresaId, new URL(request.url).searchParams));
  } catch (err) {
    return fallo(err, "GET /ordenes-compra");
  }
}

export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos de la orden");
    try {
      return ok(await crearOrden(c.pool, { empresaId: c.empresaId, usuarioId: c.usuarioId, nombre: c.nombre }, b), 201);
    } catch (e) {
      if (e instanceof OrdenError) throw new ErrorV2(e.message);
      throw e;
    }
  } catch (err) {
    return fallo(err, "POST /ordenes-compra");
  }
}
