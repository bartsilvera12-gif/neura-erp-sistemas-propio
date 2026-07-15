import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { anularGasto, GastoError } from "@/lib/gastos/server/gastos-pg";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/gastos/[id]/anular — confirmado → anulado (conserva número; guarda motivo/usuario). */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const body = await request.json().catch(() => ({}));
    const header = await anularGasto(schema, auth.empresaId, id, String(body.motivo ?? ""), auth.usuarioCatalogId);
    return NextResponse.json(successResponse({ gasto: header }));
  } catch (e) {
    if (e instanceof GastoError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/gastos/[id]/anular]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo anular el documento."), { status: 500 });
  }
}
