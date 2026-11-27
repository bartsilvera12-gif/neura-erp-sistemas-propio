import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/**
 * GET /api/v2/cotizacion-dolar
 * Cotización del día del dólar (USD→PYG) desde la API pública de Cambios Chaco,
 * para prellenar el tipo de cambio en órdenes/solicitudes en dólares.
 * Devuelve compra, venta, fecha y fuente. Cacheado 15 min por instancia.
 */
type Coti = { compra: number; venta: number; fecha: string | null; fuente: string };
let cache: { at: number; data: Coti } | null = null;
const TTL = 15 * 60 * 1000;
const FUENTE_URL = "https://www.cambioschaco.com.py/api/branch_office/1/exchange";

export async function GET(request: Request) {
  try {
    await ctxV2(request, "compras"); // solo sesión con acceso a Compras
    if (cache && Date.now() - cache.at < TTL) return ok(cache.data);

    const r = await fetch(FUENTE_URL, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new ErrorV2("No se pudo obtener la cotización del día.", 502);
    const j = (await r.json()) as { updateTs?: string; items?: { isoCode: string; purchasePrice: number; salePrice: number }[] };
    const usd = (j.items ?? []).find((x) => x.isoCode === "USD");
    if (!usd) throw new ErrorV2("La fuente no devolvió la cotización del dólar.", 502);

    const data: Coti = {
      compra: Number(usd.purchasePrice) || 0,
      venta: Number(usd.salePrice) || 0,
      fecha: j.updateTs ?? null,
      fuente: "Cambios Chaco",
    };
    cache = { at: Date.now(), data };
    return ok(data);
  } catch (err) {
    return fallo(err, "GET /cotizacion-dolar");
  }
}
