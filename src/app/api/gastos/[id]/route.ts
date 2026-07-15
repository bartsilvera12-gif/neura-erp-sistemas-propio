import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { getGasto, updateBorrador, deleteBorrador, parseGastoHeaderInput, GastoError } from "@/lib/gastos/server/gastos-pg";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/gastos/[id] — detalle (cabecera + líneas). Nivel empresa. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const detalle = await getGasto(schema, ctx.auth.empresa_id, id);
    if (!detalle) return NextResponse.json(errorResponse("Documento no encontrado."), { status: 404 });
    return NextResponse.json(successResponse(detalle));
  } catch (err) {
    console.error("[/api/gastos/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el documento."), { status: 500 });
  }
}

/** PATCH /api/gastos/[id] — edita un borrador. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const input = parseGastoHeaderInput(await request.json().catch(() => ({})));
    const header = await updateBorrador(schema, auth.empresaId, id, input);
    return NextResponse.json(successResponse({ gasto: header }));
  } catch (e) {
    if (e instanceof GastoError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/gastos/[id] PATCH]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo actualizar el borrador."), { status: 500 });
  }
}

/** DELETE /api/gastos/[id] — elimina un borrador. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    await deleteBorrador(schema, auth.empresaId, id);
    return NextResponse.json(successResponse({ deleted: true, id }));
  } catch (e) {
    if (e instanceof GastoError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/gastos/[id] DELETE]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo eliminar el borrador."), { status: 500 });
  }
}
