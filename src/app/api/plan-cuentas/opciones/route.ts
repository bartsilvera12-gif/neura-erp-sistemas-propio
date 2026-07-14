import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listCuentasContablesOpciones } from "@/lib/plan-cuentas/opciones-pg";

export const runtime = "nodejs";

/**
 * GET /api/plan-cuentas/opciones — cuentas activas + asentables de la empresa,
 * para el selector de "Cuenta contable" en Compras. Cualquier usuario autenticado
 * de la empresa (no requiere admin, a diferencia de la administración del catálogo).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const cuentas = await listCuentasContablesOpciones(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ cuentas }));
  } catch (err) {
    console.error("[/api/plan-cuentas/opciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las cuentas contables."), { status: 500 });
  }
}
