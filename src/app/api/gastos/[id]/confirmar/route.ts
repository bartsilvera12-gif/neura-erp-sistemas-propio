import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { confirmarDirecto, parseGastoHeaderInput, GastoError } from "@/lib/gastos/server/gastos-pg";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/gastos/[id]/confirmar — guarda (si viene body) y CONFIRMA un documento
 * existente en un solo paso: borrador → confirmado, o histórico → confirmado
 * (sin pasar por borrador). Reserva el número GS.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const body = await request.json().catch(() => ({}));
    const input = parseGastoHeaderInput(body);
    const header = await confirmarDirecto(schema, auth.empresaId, { id, header: input, userId: auth.usuarioCatalogId });
    return NextResponse.json(successResponse({ gasto: header }));
  } catch (e) {
    if (e instanceof GastoError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/gastos/[id]/confirmar]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo confirmar el documento."), { status: 500 });
  }
}
