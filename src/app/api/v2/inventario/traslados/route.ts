import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { listarTraslados, observacionTraslado } from "@/lib/erp2/inventario-docs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    return ok(await listarTraslados(c.pool, c.empresaId, new URL(request.url).searchParams));
  } catch (err) {
    return fallo(err, "GET /inventario/traslados");
  }
}

/** Crea el traslado: sale del origen y queda en tránsito (inv_crear_traslado). */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || !Array.isArray(b.items)) throw new ErrorV2("El traslado no tiene productos");
    const p = {
      ubicacion_origen_id: b.deposito_origen_id,
      ubicacion_destino_id: b.deposito_destino_id,
      observacion: observacionTraslado(b),
      idempotency_key: b.idempotency_key ?? null,
      items: (b.items as Record<string, unknown>[]).map((it) => ({ producto_id: it.producto_id, cantidad: it.cantidad })),
    };
    const { rows } = await c.pool.query(`SELECT neura.inv_crear_traslado($1::uuid, $2::uuid, $3, $4::jsonb) AS r`, [
      c.empresaId,
      c.usuarioId,
      c.nombre,
      JSON.stringify(p),
    ]);
    const r = rows[0].r as { id: string; numero: string };
    return ok({ ...r, remision_numero: `001-001-${(r.numero.match(/\d+$/)?.[0] ?? "0").padStart(7, "0")}` }, 201);
  } catch (err) {
    return fallo(err, "POST /inventario/traslados");
  }
}
