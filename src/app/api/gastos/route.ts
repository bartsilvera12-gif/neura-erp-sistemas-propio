import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listGastos, createBorrador, parseGastoHeaderInput, GastoError } from "@/lib/gastos/server/gastos-pg";

export const runtime = "nodejs";

/** GET /api/gastos — lista de Gastos y Servicios (nivel empresa; lectura). Filtros por querystring. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const url = new URL(request.url);
    const gastos = await listGastos(schema, ctx.auth.empresa_id, {
      estado: url.searchParams.get("estado") ?? undefined,
      proveedor_id: url.searchParams.get("proveedor_id") ?? undefined,
      desde: url.searchParams.get("desde") ?? undefined,
      hasta: url.searchParams.get("hasta") ?? undefined,
    });
    return NextResponse.json(successResponse({ gastos }));
  } catch (err) {
    console.error("[/api/gastos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los gastos y servicios."), { status: 500 });
  }
}

/** POST /api/gastos — crea un borrador (requiere permiso contabilidad). */
export async function POST(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const body = await request.json().catch(() => ({}));
    const input = parseGastoHeaderInput(body);
    const header = await createBorrador(schema, auth.empresaId, input, auth.usuarioCatalogId);
    return NextResponse.json(successResponse({ gasto: header }), { status: 201 });
  } catch (e) {
    if (e instanceof GastoError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/gastos POST]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo crear el borrador."), { status: 500 });
  }
}
