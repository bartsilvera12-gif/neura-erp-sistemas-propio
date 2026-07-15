import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listLibroDiario, type DiarioFilters } from "@/lib/contabilidad/libros-pg";

export const runtime = "nodejs";

export function diarioFiltersFromUrl(url: URL): DiarioFilters {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  return {
    desde: g("desde"), hasta: g("hasta"), cuenta_id: g("cuenta_id"),
    origen: g("origen"), estado: g("estado"), numero_asiento: g("numero_asiento"), proveedor_id: g("proveedor_id"),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const out = await listLibroDiario(schema, auth.empresaId, diarioFiltersFromUrl(new URL(request.url)));
    return NextResponse.json(successResponse(out));
  } catch (e) {
    console.error("[/api/reportes/libro-diario GET]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo generar el Libro Diario."), { status: 500 });
  }
}
