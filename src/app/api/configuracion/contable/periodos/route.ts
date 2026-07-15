import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listPeriodos, upsertPeriodo } from "@/lib/contabilidad/config-pg";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

export const runtime = "nodejs";

/** GET /api/configuracion/contable/periodos — lista de períodos. */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    return NextResponse.json(successResponse({ periodos: await listPeriodos(schema, auth.empresaId) }));
  } catch (e) {
    console.error("[/api/.../periodos GET]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudieron cargar los períodos."), { status: 500 });
  }
}

/** POST /api/configuracion/contable/periodos — crea/cierra/reabre un período. */
export async function POST(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const anio = Number(body.anio), mes = Number(body.mes);
    const estado = String(body.estado) === "cerrado" ? "cerrado" : "abierto";
    const periodo = await upsertPeriodo(schema, auth.empresaId, anio, mes, estado, auth.usuarioCatalogId);
    return NextResponse.json(successResponse({ periodo }));
  } catch (e) {
    if (e instanceof ContabilidadError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/.../periodos POST]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo actualizar el período."), { status: 500 });
  }
}
