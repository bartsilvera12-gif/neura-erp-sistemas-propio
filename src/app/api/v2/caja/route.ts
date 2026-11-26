import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { abrirTurno, estadoCajas, usrCaja } from "@/lib/erp2/caja";

export const runtime = "nodejs";

/**
 * GET → { caja, abiertas, predeterminada }. `caja` = el turno que le toca al usuario. Si no hay
 * ninguno abierto, compras y pagos a proveedores siguen pagando en efectivo con la cuenta Caja de
 * la configuración contable (como siempre en Neura): por eso se devuelve igual una "Caja".
 * POST { punto_venta_id, monto_apertura, observacion? } → abre un turno.
 */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, null);
    const e = await estadoCajas(c.pool, usrCaja(c)).catch((err) => {
      // Sin las tablas de caja (SQL 20261127100000 sin correr) compras sigue como antes.
      if ((err as { code?: string }).code === "42P01") return null;
      throw err;
    });
    if (!e) return ok({ caja: { id: c.empresaId, nombre: "Caja" }, abiertas: [], predeterminada: null });
    const caja = e.abiertas.find((a) => a.id === e.predeterminada) ?? e.abiertas[0] ?? { id: c.empresaId, nombre: "Caja" };
    return ok({ caja, abiertas: e.abiertas, predeterminada: e.predeterminada });
  } catch (err) {
    return fallo(err, "GET /caja");
  }
}

export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "ventas");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw new ErrorV2("Faltan los datos de la apertura");
    const monto = b.monto_apertura == null || b.monto_apertura === "" ? 0 : Number(b.monto_apertura);
    return ok(await abrirTurno(c.pool, usrCaja(c), String(b.punto_venta_id ?? ""), monto, typeof b.observacion === "string" ? b.observacion : null), 201);
  } catch (err) {
    return fallo(err, "POST /caja");
  }
}
