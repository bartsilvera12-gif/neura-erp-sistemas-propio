import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { listarAjustes } from "@/lib/erp2/inventario-docs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    return ok(await listarAjustes(c.pool, c.empresaId, new URL(request.url).searchParams));
  } catch (err) {
    return fallo(err, "GET /inventario/ajustes");
  }
}

/** Registra el ajuste o la pérdida: el stock se mueve en la misma transacción (inv_registrar_ajuste). */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || !Array.isArray(b.items)) throw new ErrorV2("El documento no tiene productos");
    // "Vencimiento" no está entre los motivos de pérdida de Neura (no maneja lotes): va como
    // "otro" con el detalle, así queda dicho igual.
    const venc = b.tipo === "perdida" && b.motivo === "vencimiento";
    const detalle = String(b.detalle ?? "").trim();
    const p = {
      tipo: b.tipo,
      ubicacion_id: b.deposito_id,
      motivo: venc ? "otro" : b.motivo,
      detalle: venc ? `Vencimiento${detalle ? `: ${detalle}` : ""}` : detalle,
      idempotency_key: b.idempotency_key ?? null,
      items: (b.items as Record<string, unknown>[]).map((it) => ({
        producto_id: it.producto_id,
        modo: it.modo ?? "diferencia",
        cantidad: it.cantidad,
        nota: it.nota ?? "",
      })),
    };
    const { rows } = await c.pool.query(`SELECT neura.inv_registrar_ajuste($1::uuid, $2::uuid, $3, $4::jsonb) AS r`, [
      c.empresaId,
      c.usuarioId,
      c.nombre,
      JSON.stringify(p),
    ]);
    return ok({ ...rows[0].r, estado: "aplicado" }, 201);
  } catch (err) {
    return fallo(err, "POST /inventario/ajustes");
  }
}
