import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listLibroVentas, computeTotals, type LibroVentaFilters } from "@/lib/libro-ventas/libro-ventas-pg";

export const runtime = "nodejs";

function filtersFromUrl(url: URL): LibroVentaFilters {
  const g = (k: string) => url.searchParams.get(k) || undefined;
  const cond = g("condicion");
  const origen = g("origen");
  const tipo = g("tipo");
  return {
    desde: g("desde"),
    hasta: g("hasta"),
    cliente_id: g("cliente_id"),
    condicion: cond === "contado" || cond === "credito" ? cond : undefined,
    origen: origen === "manual" || origen === "suscripcion" ? origen : undefined,
    tipo: tipo === "factura" || tipo === "nota_credito" ? tipo : undefined,
  };
}

/** GET /api/reportes/libro-ventas — Libro de Ventas fiscal (requiere permiso contabilidad). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const rows = await listLibroVentas(schema, auth.empresaId, filtersFromUrl(new URL(request.url)));
    return NextResponse.json(successResponse({ rows, totals: computeTotals(rows) }));
  } catch (err) {
    console.error("[/api/reportes/libro-ventas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el Libro de Ventas."), { status: 500 });
  }
}
