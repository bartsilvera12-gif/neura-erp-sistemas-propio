import { ctxV2, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/** Neura no tiene planes de cuotas: el crédito va en una sola cuota. */
export async function GET(request: Request) {
  try {
    await ctxV2(request, "ventas");
    return ok({ max_cuotas: 1, planes: [] });
  } catch (err) {
    return fallo(err, "GET /cuotas/planes");
  }
}
