import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { cambiarEstadoOrden, OrdenError } from "@/lib/ordenes/server/ordenes-pg";
import { str } from "@/lib/ordenes/parse-items";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** POST — aprobar | cancelar | cerrar. Cancelar y cerrar exigen motivo (auditoría). */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const accion = str(body.accion);
    if (!["aprobar", "cancelar", "cerrar"].includes(accion)) {
      return NextResponse.json(errorResponse("Acción inválida."), { status: 400 });
    }
    const orden = await cambiarEstadoOrden(
      schema, ctx.auth.empresa_id, id,
      accion as "aprobar" | "cancelar" | "cerrar",
      str(body.motivo) || null,
      ctx.auth.usuarioCatalogId ?? null
    );
    return NextResponse.json(successResponse({ orden }));
  } catch (e) {
    if (e instanceof OrdenError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/ordenes/[id]/estado POST]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo cambiar el estado de la orden."), { status: 500 });
  }
}
