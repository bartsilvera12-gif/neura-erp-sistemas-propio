import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listLibroMayor, type MayorFilters } from "@/lib/contabilidad/libros-pg";

export const runtime = "nodejs";

export function mayorFiltersFromUrl(url: URL): MayorFilters {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  return {
    desde: g("desde"), hasta: g("hasta"), cuenta_id: g("cuenta_id"),
    nivel: g("nivel"), naturaleza: g("naturaleza"), origen: g("origen"), proveedor_id: g("proveedor_id"),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const out = await listLibroMayor(schema, auth.empresaId, mayorFiltersFromUrl(new URL(request.url)));
    return NextResponse.json(successResponse(out));
  } catch (e) {
    console.error("[/api/reportes/libro-mayor GET]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo generar el Libro Mayor."), { status: 500 });
  }
}
