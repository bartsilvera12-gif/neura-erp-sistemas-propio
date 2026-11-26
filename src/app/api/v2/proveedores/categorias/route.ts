import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { categoriasProveedor } from "@/lib/erp2/proveedores";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, null);
    return ok({ categorias: await categoriasProveedor(c.pool, c.empresaId) });
  } catch (err) {
    return fallo(err, "GET /proveedores/categorias");
  }
}
