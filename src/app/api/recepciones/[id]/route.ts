import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getRecepcion } from "@/lib/recepciones/server/recepciones-pg";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await context.params;
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getRecepcion(schema, ctx.auth.empresa_id, id);
    if (!data) return NextResponse.json(errorResponse("Recepción no encontrada."), { status: 404 });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/recepciones/[id] GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar la recepción."), { status: 500 });
  }
}
