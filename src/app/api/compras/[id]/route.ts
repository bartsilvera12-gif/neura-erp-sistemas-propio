import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { updateCompraCuentaContable } from "@/lib/compras/server/compras-pg";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/compras/[id] — edición ACOTADA: solo la cuenta contable asociada.
 * No toca proveedor, producto, montos ni el impacto en inventario ya generado.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!("cuenta_contable_id" in body)) {
      return NextResponse.json(errorResponse("No hay cambios para aplicar."), { status: 400 });
    }
    const raw = body.cuenta_contable_id;
    const cuentaContableId = raw == null || String(raw).trim() === "" ? null : String(raw);

    try {
      const compra = await updateCompraCuentaContable(schema, ctx.auth.empresa_id, id, cuentaContableId);
      if (!compra) return NextResponse.json(errorResponse("Compra no encontrada."), { status: 404 });
      return NextResponse.json(successResponse({ compra }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo actualizar la compra.";
      const code = (e as { code?: string })?.code;
      if (code === "23503") {
        return NextResponse.json(errorResponse("La cuenta contable seleccionada no existe."), { status: 400 });
      }
      return NextResponse.json(errorResponse(msg), { status: 400 });
    }
  } catch (err) {
    console.error("[/api/compras/[id] PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo actualizar la compra."), { status: 500 });
  }
}
