import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listCuentasPorPagar, computeTotals, type CuentasPagarFilters } from "@/lib/reportes/cuentas-pagar-pg";

export const runtime = "nodejs";

function filtersFromUrl(url: URL): CuentasPagarFilters {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  return { desde: g("desde"), hasta: g("hasta"), proveedor_id: g("proveedor_id"), estado: g("estado") };
}

/** GET /api/reportes/cuentas-por-pagar — deuda de compras a crédito (permiso contabilidad). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const rows = await listCuentasPorPagar(schema, auth.empresaId, filtersFromUrl(new URL(request.url)));
    return NextResponse.json(successResponse({ rows, totals: computeTotals(rows) }));
  } catch (err) {
    console.error("[/api/reportes/cuentas-por-pagar GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar Cuentas por Pagar."), { status: 500 });
  }
}
