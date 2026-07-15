import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { getConfigView, saveConfig } from "@/lib/contabilidad/config-pg";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

export const runtime = "nodejs";

/** GET /api/configuracion/contable — configuración contable de la empresa. */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    return NextResponse.json(successResponse({ config: await getConfigView(schema, auth.empresaId) }));
  } catch (e) {
    console.error("[/api/configuracion/contable GET]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo cargar la configuración contable."), { status: 500 });
  }
}

/** PUT /api/configuracion/contable — guarda las cuentas por defecto (activas + asentables). */
export async function PUT(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const config = await saveConfig(schema, auth.empresaId, body, auth.usuarioCatalogId);
    return NextResponse.json(successResponse({ config }));
  } catch (e) {
    if (e instanceof ContabilidadError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/configuracion/contable PUT]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo guardar la configuración contable."), { status: 500 });
  }
}
