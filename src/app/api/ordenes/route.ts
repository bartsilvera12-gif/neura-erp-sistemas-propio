import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listOrdenes, createOrden, OrdenError } from "@/lib/ordenes/server/ordenes-pg";
import { parseOrdenItems, UUID_RE, str } from "@/lib/ordenes/parse-items";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const sp = request.nextUrl.searchParams;
    const ordenes = await listOrdenes(schema, ctx.auth.empresa_id, {
      estado: sp.get("estado"), proveedor_id: sp.get("proveedor_id"),
      desde: sp.get("desde"), hasta: sp.get("hasta"),
    });
    return NextResponse.json(successResponse({ ordenes }));
  } catch (err) {
    console.error("[/api/ordenes GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las órdenes de compra."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (!UUID_RE.test(str(body.proveedor_id))) {
      return NextResponse.json(errorResponse("Seleccioná un proveedor."), { status: 400 });
    }
    const idem = str(body.idempotency_key);
    const hoy = new Date().toISOString().slice(0, 10);

    const orden = await createOrden(schema, empresaId, {
      proveedor_id: str(body.proveedor_id),
      proveedor_nombre: str(body.proveedor_nombre),
      fecha: str(body.fecha) || hoy,
      fecha_estimada: str(body.fecha_estimada) || null,
      observaciones: str(body.observaciones) || null,
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      tipo_cambio: Number(body.tipo_cambio) || 1,
      items: parseOrdenItems(body.items),
      idempotency_key: UUID_RE.test(idem) ? idem : null,
      created_by: ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse({ orden }));
  } catch (e) {
    if (e instanceof OrdenError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/ordenes POST]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo crear la orden de compra."), { status: 500 });
  }
}
