import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCobranzasApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { rechazarTransferencia, ConciliacionError } from "@/lib/cobranzas/conciliacion-pg";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

/** POST — rechaza una transferencia (exige motivo; sin impacto en factura/contabilidad). */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireCobranzasApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const { id } = await ctx.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await rechazarTransferencia(schema, auth.empresaId, id, String(body.motivo ?? ""), auth.usuarioCatalogId);
    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    if (e instanceof ConciliacionError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/cobranzas/conciliacion/[id]/rechazar]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo rechazar la transferencia."), { status: 500 });
  }
}
