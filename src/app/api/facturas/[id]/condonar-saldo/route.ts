import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCobranzasApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { condonarSaldoFactura, CondonarError } from "@/lib/facturacion/condonar-saldo-pg";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/facturas/[id]/condonar-saldo  (SOLO admin)
 * Condona/da por incobrable el SALDO restante de una factura parcialmente pagada:
 * saldo → 0, factura Pagada (etiqueta condonación), asiento Debe Descuentos/Incobrables /
 * Haber Clientes (si estaba contabilizada). No toca los pagos.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireCobranzasApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  if (!esRolAdminEmpresaOGlobal(auth.rol)) {
    return NextResponse.json(errorResponse("Solo administradores pueden condonar saldos."), { status: 403 });
  }
  try {
    const { id } = await ctx.params;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const tipo = String(body.tipo ?? "condonado") === "incobrable" ? "incobrable" : "condonado";
    const res = await condonarSaldoFactura(schema, auth.empresaId, id, tipo, String(body.motivo ?? ""), auth.usuarioCatalogId);
    return NextResponse.json(successResponse({ ok: true, ...res }));
  } catch (e) {
    if (e instanceof CondonarError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    if (e instanceof ContabilidadError) return NextResponse.json(errorResponse(e.message), { status: 400 });
    console.error("[/api/facturas/[id]/condonar-saldo]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo condonar el saldo."), { status: 500 });
  }
}
