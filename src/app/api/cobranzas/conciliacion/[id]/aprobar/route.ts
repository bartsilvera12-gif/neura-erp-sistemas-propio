import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCobranzasApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { aprobarTransferencia, ConciliacionError } from "@/lib/cobranzas/conciliacion-pg";
import { limpiarNotificacionesCobro } from "@/lib/cobranzas/cobro-pendiente-notificar";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

/** POST — aprueba una transferencia (atómico: pago + saldo + asiento + estado). */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireCobranzasApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const { id } = await ctx.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const out = await aprobarTransferencia(schema, auth.empresaId, id, auth.usuarioCatalogId);
    // Ya resuelto: limpiar el aviso de la campanita (best-effort).
    await limpiarNotificacionesCobro(schema, auth.empresaId, id);
    return NextResponse.json(successResponse(out));
  } catch (e) {
    if (e instanceof ConciliacionError || e instanceof ContabilidadError) {
      return NextResponse.json(errorResponse(e.message), { status: e.status });
    }
    console.error("[/api/cobranzas/conciliacion/[id]/aprobar]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo aprobar la transferencia."), { status: 500 });
  }
}
