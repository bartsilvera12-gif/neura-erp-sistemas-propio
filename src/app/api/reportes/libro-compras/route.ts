import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listLibroCompras, computeTotals, type LibroFilters } from "@/lib/libro-compras/libro-compras-pg";

export const runtime = "nodejs";

function filtersFromUrl(url: URL): LibroFilters {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  const origen = g("origen");
  return {
    desde: g("desde"),
    hasta: g("hasta"),
    proveedor_id: g("proveedor_id"),
    origen: origen === "compra" || origen === "gasto" ? origen : undefined,
    tipo_comprobante: g("tipo_comprobante"),
    condicion: g("condicion"),
  };
}

/** GET /api/reportes/libro-compras — Libro de Compras (requiere permiso contabilidad). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const rows = await listLibroCompras(schema, auth.empresaId, filtersFromUrl(new URL(request.url)));
    return NextResponse.json(successResponse({ rows, totals: computeTotals(rows) }));
  } catch (err) {
    console.error("[/api/reportes/libro-compras GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el Libro de Compras."), { status: 500 });
  }
}
