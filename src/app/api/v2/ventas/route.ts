import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { listarVentas } from "@/lib/erp2/caja";

export const runtime = "nodejs";

/** Órdenes de venta de las cajas (paginado en el servidor). */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    const sp = new URL(request.url).searchParams;
    const s = (k: string) => (sp.get(k) ?? "").trim().slice(0, 120);
    return ok(
      await listarVentas(c.pool, c.empresaId, {
        pagina: Math.max(1, Number(sp.get("pagina")) || 1),
        porPagina: Math.min(200, Math.max(5, Number(sp.get("por_pagina")) || 25)),
        q: s("q"), tipo: s("tipo"), iva: s("iva"), estado: s("estado"), punto: s("punto"), metodo: s("metodo"),
        desde: s("desde"), hasta: s("hasta"), contar: sp.get("contar") !== "0",
      })
    );
  } catch (err) {
    return fallo(err, "GET /ventas");
  }
}
