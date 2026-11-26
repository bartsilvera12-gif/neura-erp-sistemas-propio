import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { crearProveedor, listarProveedores } from "@/lib/erp2/proveedores";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, null);
    return ok({ proveedores: await listarProveedores(c.pool, c.empresaId) });
  } catch (err) {
    return fallo(err, "GET /proveedores");
  }
}

export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos del proveedor");
    return ok(await crearProveedor(c.pool, c.empresaId, b), 201);
  } catch (err) {
    return fallo(err, "POST /proveedores");
  }
}
