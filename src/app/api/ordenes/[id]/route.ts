import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getOrden, updateOrden, OrdenError } from "@/lib/ordenes/server/ordenes-pg";
import { parseOrdenItems, UUID_RE, str } from "@/lib/ordenes/parse-items";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getOrden(schema, ctx.auth.empresa_id, id);
    if (!data) return NextResponse.json(errorResponse("Orden no encontrada."), { status: 404 });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/ordenes/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la orden."), { status: 500 });
  }
}

/** PUT — edición completa. Solo si la orden no tiene recepciones (validado en el server). */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!UUID_RE.test(str(body.proveedor_id))) {
      return NextResponse.json(errorResponse("Seleccioná un proveedor."), { status: 400 });
    }
    const orden = await updateOrden(schema, ctx.auth.empresa_id, id, {
      proveedor_id: str(body.proveedor_id),
      proveedor_nombre: str(body.proveedor_nombre),
      fecha: str(body.fecha) || new Date().toISOString().slice(0, 10),
      fecha_estimada: str(body.fecha_estimada) || null,
      observaciones: str(body.observaciones) || null,
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      tipo_cambio: Number(body.tipo_cambio) || 1,
      items: parseOrdenItems(body.items),
    });
    return NextResponse.json(successResponse({ orden }));
  } catch (e) {
    if (e instanceof OrdenError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/ordenes/[id] PUT]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo actualizar la orden."), { status: 500 });
  }
}
