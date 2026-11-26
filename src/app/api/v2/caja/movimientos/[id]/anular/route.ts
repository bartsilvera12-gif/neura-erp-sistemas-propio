import { ctxV2, fallo, ok } from "@/lib/erp2/server";
import { anularMovimiento, usrCaja } from "@/lib/erp2/caja";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await ctxV2(request, "ventas");
    const { id } = await params;
    const b = (await request.json().catch(() => ({}))) as { motivo?: string };
    return ok(await anularMovimiento(c.pool, usrCaja(c), id, String(b.motivo ?? "")));
  } catch (err) {
    return fallo(err, "POST /caja/movimientos/[id]/anular");
  }
}
