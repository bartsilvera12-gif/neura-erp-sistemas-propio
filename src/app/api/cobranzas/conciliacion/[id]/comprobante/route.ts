import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId, createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCobranzasApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { getCobroPendiente } from "@/lib/cobranzas/conciliacion-pg";
import { signCobroComprobante } from "@/lib/cobranzas/conciliacion-comprobante-storage";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

/** GET — URL firmada del comprobante de la transferencia (TTL 1h). */
export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireCobranzasApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const { id } = await ctx.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const cobro = await getCobroPendiente(schema, auth.empresaId, id);
    if (!cobro) return NextResponse.json(errorResponse("Transferencia no encontrada."), { status: 404 });
    const supabase = await createServiceRoleClientForEmpresa(auth.empresaId);
    const url = cobro.comprobante_path ? await signCobroComprobante(supabase, cobro.comprobante_path, 3600) : null;
    return NextResponse.json(successResponse({ comprobante_path: cobro.comprobante_path, comprobante_url: url }));
  } catch (err) {
    console.error("[/api/cobranzas/conciliacion/[id]/comprobante GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo obtener el comprobante."), { status: 500 });
  }
}
