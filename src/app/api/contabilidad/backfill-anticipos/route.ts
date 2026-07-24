import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { sweepReclasificarAnticipos } from "@/lib/cobranzas/conciliacion-pg";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/contabilidad/backfill-anticipos — reclasifica de forma idempotente
 * todo cobro-anticipo cuya factura ya tenga asiento de venta (red de seguridad
 * si falló el hook post-DTE). Debe Anticipos / Haber Clientes.
 */
export async function POST(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const result = await sweepReclasificarAnticipos(schema, auth.empresaId, auth.usuarioCatalogId);
    return NextResponse.json(successResponse({ result }));
  } catch (err) {
    console.error("[/api/contabilidad/backfill-anticipos POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo ejecutar el backfill de anticipos."), { status: 500 });
  }
}
