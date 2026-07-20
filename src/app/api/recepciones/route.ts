import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listRecepciones, confirmarRecepcion, RecepcionError, type RecepcionItemInput } from "@/lib/recepciones/server/recepciones-pg";
import { UUID_RE, str } from "@/lib/ordenes/parse-items";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const sp = request.nextUrl.searchParams;
    const recepciones = await listRecepciones(schema, ctx.auth.empresa_id, {
      orden_id: sp.get("orden_id"), estado_facturacion: sp.get("estado_facturacion"),
      desde: sp.get("desde"), hasta: sp.get("hasta"),
    });
    return NextResponse.json(successResponse({ recepciones }));
  } catch (err) {
    console.error("[/api/recepciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las recepciones."), { status: 500 });
  }
}

/** POST — confirma una recepción: aumenta stock UNA sola vez, sin asiento contable. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (!UUID_RE.test(str(body.orden_id))) {
      return NextResponse.json(errorResponse("Falta la orden de compra."), { status: 400 });
    }
    const items: RecepcionItemInput[] = (Array.isArray(body.items) ? body.items : [])
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return {
          orden_item_id: str(o.orden_item_id),
          cantidad_recibida: Number(o.cantidad_recibida) || 0,
          costo_unitario_recibido: Number(o.costo_unitario_recibido) || 0,
        };
      })
      .filter((i) => UUID_RE.test(i.orden_item_id) && i.cantidad_recibida > 0);

    if (items.length === 0) {
      return NextResponse.json(errorResponse("Cargá al menos una cantidad recibida."), { status: 400 });
    }
    const idem = str(body.idempotency_key);

    const recepcion = await confirmarRecepcion(schema, empresaId, {
      orden_id: str(body.orden_id),
      fecha: str(body.fecha) || new Date().toISOString().slice(0, 10),
      ubicacion_id: UUID_RE.test(str(body.ubicacion_id)) ? str(body.ubicacion_id) : null,
      observacion: str(body.observacion) || null,
      documento_url: str(body.documento_url) || null,
      items,
      permitir_excedente: body.permitir_excedente === true,
      motivo_excedente: str(body.motivo_excedente) || null,
      idempotency_key: UUID_RE.test(idem) ? idem : null,
      created_by: ctx.auth.usuarioCatalogId ?? null,
      usuario_nombre: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse({ recepcion }));
  } catch (e) {
    if (e instanceof RecepcionError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/recepciones POST]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo registrar la recepción."), { status: 500 });
  }
}
