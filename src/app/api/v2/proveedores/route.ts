import { ctxV2, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

/** Proveedores para elegir (forma corta del 2.0). Alta y edición siguen en Proveedores de Neura. */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, null);
    const { rows } = await c.pool.query(
      `SELECT id, nombre, nombre_comercial, ruc, contacto, (COALESCE(estado, 'activo') = 'activo') AS activo,
              condicion_pago, plazo_pago_dias, COALESCE(moneda_preferida, 'PYG') AS moneda
         FROM neura.proveedores WHERE empresa_id = $1::uuid ORDER BY lower(COALESCE(nombre_comercial, nombre))`,
      [c.empresaId]
    );
    return ok({ proveedores: rows });
  } catch (err) {
    return fallo(err, "GET /proveedores");
  }
}
