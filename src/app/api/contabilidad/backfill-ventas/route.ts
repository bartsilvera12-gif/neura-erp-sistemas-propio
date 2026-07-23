import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { sweepContabilizarVentas } from "@/lib/contabilidad/ventas-asientos-pg";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/contabilidad/backfill-ventas — contabiliza de forma idempotente todas
 * las facturas y NC con DTE aprobado que aún no tengan asiento. No toca
 * documentos no fiscales ni duplica asientos. Requiere permiso de Contabilidad.
 */
export async function POST(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const result = await sweepContabilizarVentas(schema, auth.empresaId, auth.usuarioCatalogId);
    return NextResponse.json(successResponse({ result }));
  } catch (err) {
    console.error("[/api/contabilidad/backfill-ventas POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo ejecutar el backfill de ventas."), { status: 500 });
  }
}
