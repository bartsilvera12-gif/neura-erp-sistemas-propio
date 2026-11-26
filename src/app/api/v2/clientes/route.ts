import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { buscarClientes, crearCliente } from "@/lib/erp2/clientes";

export const runtime = "nodejs";

/** Buscador de clientes de la caja (?q= / ?limit=) y alta rápida. */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    const sp = new URL(request.url).searchParams;
    return ok(await buscarClientes(c.pool, c.empresaId, (sp.get("q") ?? "").trim().slice(0, 100), Math.min(50, Math.max(1, Number(sp.get("limit")) || 20))));
  } catch (err) {
    return fallo(err, "GET /clientes");
  }
}

export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos del cliente");
    return ok(await crearCliente(c.pool, c.empresaId, c.authUserId, b), 201);
  } catch (err) {
    return fallo(err, "POST /clientes");
  }
}
