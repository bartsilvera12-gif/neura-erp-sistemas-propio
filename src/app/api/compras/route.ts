import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listCompras, insertCompraConImpacto, insertCompraMultilinea, type CompraItemInput, type IvaTipo } from "@/lib/compras/server/compras-pg";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

type TenantCtx = Awaited<ReturnType<typeof getTenantSupabaseFromAuth>>;

/**
 * Compra multilínea. `origen_compra`:
 *  - 'directa'   → aumenta stock (afecta_stock=true) como la compra directa de siempre.
 *  - 'recepcion' → NO aumenta stock: consume cantidades ya recibidas pendientes de
 *                  facturar y solo registra lo fiscal/contable.
 * En ambos casos genera asiento y aparece en Libro de Compras, Diario y Mayor.
 */
async function postMultilinea(
  body: Record<string, unknown>,
  schema: string,
  empresaId: string,
  ctx: NonNullable<TenantCtx>,
  UUID_RE: RegExp
) {
  const s = (v: unknown) => (v == null ? "" : String(v).trim());
  const origen = body.origen_compra === "recepcion" ? "recepcion" : "directa";

  if (!UUID_RE.test(s(body.proveedor_id))) {
    return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });
  }
  if (!s(body.nro_timbrado)) {
    return NextResponse.json(errorResponse("Falta el N° de timbrado."), { status: 400 });
  }

  const items: CompraItemInput[] = [];
  for (const [i, raw] of (body.items as unknown[]).entries()) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const iva = s(o.iva_tipo);
    if (!["exenta", "5", "10"].includes(iva)) {
      return NextResponse.json(errorResponse(`Línea ${i + 1}: tipo de IVA inválido.`), { status: 400 });
    }
    if (!UUID_RE.test(s(o.cuenta_contable_id))) {
      return NextResponse.json(errorResponse(`Línea ${i + 1}: seleccioná la cuenta contable.`), { status: 400 });
    }
    if (!(Number(o.cantidad) > 0)) {
      return NextResponse.json(errorResponse(`Línea ${i + 1}: la cantidad debe ser mayor a 0.`), { status: 400 });
    }
    if (!(Number(o.costo_unitario) > 0)) {
      return NextResponse.json(errorResponse(`Línea ${i + 1}: el costo unitario debe ser mayor a 0.`), { status: 400 });
    }
    items.push({
      producto_id: UUID_RE.test(s(o.producto_id)) ? s(o.producto_id) : null,
      producto_nombre: s(o.producto_nombre),
      descripcion: s(o.descripcion) || null,
      cantidad: Number(o.cantidad),
      costo_unitario: Number(o.costo_unitario),
      iva_tipo: iva as IvaTipo,
      cuenta_contable_id: s(o.cuenta_contable_id),
      recepcion_item_id: UUID_RE.test(s(o.recepcion_item_id)) ? s(o.recepcion_item_id) : null,
      precio_venta: o.precio_venta != null ? Number(o.precio_venta) : null,
      margen_venta: o.margen_venta != null ? Number(o.margen_venta) : null,
    });
  }

  const idem = s(body.idempotency_key);
  try {
    const out = await insertCompraMultilinea(schema, empresaId, {
      proveedor_id: s(body.proveedor_id),
      proveedor_nombre: s(body.proveedor_nombre),
      orden_compra_id: UUID_RE.test(s(body.orden_compra_id)) ? s(body.orden_compra_id) : null,
      origen_compra: origen,
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      tipo_cambio: Number(body.tipo_cambio) || 1,
      tipo_pago: body.tipo_pago === "credito" ? "credito" : "contado",
      plazo_dias: s(body.plazo_dias) ? parseInt(s(body.plazo_dias), 10) || null : null,
      nro_timbrado: s(body.nro_timbrado).toUpperCase(),
      cuenta_contrapartida_id: UUID_RE.test(s(body.cuenta_contrapartida_id)) ? s(body.cuenta_contrapartida_id) : null,
      items,
      idempotency_key: UUID_RE.test(idem) ? idem : null,
      created_by: ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse({ compra: out.compra, movimiento_id: out.movimiento_id }));
  } catch (e) {
    if (e instanceof ContabilidadError) {
      return NextResponse.json(errorResponse(e.message), { status: e.status });
    }
    const code = (e as { code?: string })?.code;
    console.error("[/api/compras POST multilinea]", { schema, empresaId, code, msg: e instanceof Error ? e.message : e });
    if (code === "23503") {
      return NextResponse.json(errorResponse("Proveedor, producto o cuenta inválidos."), { status: 400 });
    }
    return NextResponse.json(errorResponse("No se pudo guardar la compra."), { status: 500 });
  }
}

/**
 * GET /api/compras — lista via PG directo.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const rows = await listCompras(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ compras: rows }));
  } catch (err) {
    console.error("[/api/compras GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las compras."), { status: 500 });
  }
}

/**
 * POST /api/compras — crea compra + movimiento ENTRADA + actualiza producto.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // ── Camino MULTILÍNEA (compra directa multiproducto o compra desde recepción) ──
    if (Array.isArray(body.items) && body.items.length > 0) {
      return await postMultilinea(body, schema, empresaId, ctx, UUID_RE);
    }

    if (!req("proveedor_id")) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });
    if (!req("producto_id")) return NextResponse.json(errorResponse("Falta el producto."), { status: 400 });
    if (!req("cantidad") || Number(body.cantidad) <= 0)
      return NextResponse.json(errorResponse("La cantidad debe ser mayor a 0."), { status: 400 });
    if (!req("costo_unitario") || Number(body.costo_unitario) <= 0)
      return NextResponse.json(errorResponse("El costo unitario debe ser mayor a 0."), { status: 400 });
    if (!req("precio_venta") || Number(body.precio_venta) <= 0)
      return NextResponse.json(errorResponse("El precio de venta debe ser mayor a 0."), { status: 400 });
    if (!req("nro_timbrado"))
      return NextResponse.json(errorResponse("Falta el N° de timbrado."), { status: 400 });

    // IVA: aceptar SOLO 'exenta' | '5' | '10' (sin coerción silenciosa).
    const ivaTipo = String(body.iva_tipo ?? "").trim();
    if (!["exenta", "5", "10"].includes(ivaTipo)) {
      return NextResponse.json(errorResponse("Tipo de IVA inválido. Debe ser 'exenta', '5' o '10'."), { status: 400 });
    }

    // Idempotencia: solo aceptar un uuid válido; cualquier otra cosa se ignora (no rompe).
    const idemRaw = req("idempotency_key") ? String(body.idempotency_key).trim() : "";
    const idempotencyKey = UUID_RE.test(idemRaw) ? idemRaw : null;

    // Recalcular montos en backend (no confiar en el frontend). IVA INCLUIDO: el costo
    // es el total con IVA; el IVA se DEDUCE. base = total − IVA.
    const cantidad = Number(body.cantidad) || 0;
    const costoUnitario = Number(body.costo_unitario) || 0;
    const bruto = cantidad * costoUnitario;
    const montoIva = ivaTipo === "exenta" ? 0 : Math.round(bruto * (ivaTipo === "5" ? 5 / 105 : 10 / 110));
    const subtotal = bruto - montoIva;
    const total = bruto;

    try {
      const out = await insertCompraConImpacto(schema, empresaId, {
        proveedor_id: String(body.proveedor_id),
        proveedor_nombre: String(body.proveedor_nombre ?? ""),
        producto_id: String(body.producto_id),
        producto_nombre: String(body.producto_nombre ?? ""),
        cantidad,
        moneda: body.moneda === "USD" ? "USD" : "PYG",
        tipo_cambio: Number(body.tipo_cambio) || 1,
        costo_unitario_original: Number(body.costo_unitario_original) || costoUnitario || 0,
        costo_unitario: costoUnitario,
        iva_tipo: ivaTipo,
        subtotal,
        monto_iva: montoIva,
        total,
        precio_venta: Number(body.precio_venta) || 0,
        margen_venta: body.margen_venta != null ? Number(body.margen_venta) : null,
        tipo_pago: body.tipo_pago === "credito" ? "credito" : "contado",
        plazo_dias: body.plazo_dias != null && String(body.plazo_dias).trim() !== ""
          ? parseInt(String(body.plazo_dias), 10) || null : null,
        nro_timbrado: String(body.nro_timbrado).trim().toUpperCase(),
        cuenta_contable_id: req("cuenta_contable_id") ? String(body.cuenta_contable_id) : null,
        cuenta_contrapartida_id: req("cuenta_contrapartida_id") ? String(body.cuenta_contrapartida_id) : null,
        afecta_stock: body.afecta_stock === false ? false : true,
        idempotency_key: idempotencyKey,
        created_by: ctx.auth.usuarioCatalogId ?? null,
        usuario_nombre: ctx.auth.user?.email ?? null,
      });

      return NextResponse.json(successResponse({
        compra: out.compra,
        movimiento_id: out.movimiento_id,
        warning: out.movimiento_warning,
      }));
    } catch (e) {
      if (e instanceof ContabilidadError) {
        return NextResponse.json(errorResponse(e.message), { status: e.status });
      }
      const msg = e instanceof Error ? e.message : "";
      const code = (e as { code?: string })?.code;
      const detail = (e as { detail?: string })?.detail;
      console.error("[/api/compras POST]", { schema, empresaId, msg, code, detail });
      if (code === "23503") {
        return NextResponse.json(
          errorResponse("Proveedor o producto inválido. Verificá los datos seleccionados."),
          { status: 400 }
        );
      }
      if (code === "23505") {
        return NextResponse.json(
          errorResponse("Conflicto al generar el número de control. Reintentá."),
          { status: 409 }
        );
      }
      return NextResponse.json(
        errorResponse("No se pudo guardar la compra. Revisá los datos e intentá nuevamente."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/compras POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la compra."), { status: 500 });
  }
}
