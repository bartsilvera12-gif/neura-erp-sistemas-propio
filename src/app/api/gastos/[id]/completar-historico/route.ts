import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { completarHistorico, parseGastoHeaderInput, GastoError } from "@/lib/gastos/server/gastos-pg";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/gastos/[id]/completar-historico — histórico → borrador (rellena datos fiscales sin pisar los originales). */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const input = parseGastoHeaderInput(await request.json().catch(() => ({})));
    const header = await completarHistorico(schema, auth.empresaId, id, input);
    return NextResponse.json(successResponse({ gasto: header }));
  } catch (e) {
    if (e instanceof GastoError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/gastos/[id]/completar-historico]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo completar el histórico."), { status: 500 });
  }
}
