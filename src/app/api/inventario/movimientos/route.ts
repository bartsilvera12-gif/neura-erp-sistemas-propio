import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { queryWithRetry } from "@/lib/supabase/pg-retry";

/**
 * GET /api/inventario/movimientos — lista movimientos via PG directo.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schemaRaw = await fetchDataSchemaForEmpresaId(empresaId);
    const schema = assertAllowedChatDataSchema(schemaRaw);
    const pool = getChatPostgresPool();
    if (!pool) return NextResponse.json(errorResponse("Pool no disponible."), { status: 500 });
    const t = quoteSchemaTable(schema, "movimientos_inventario");
    const sp = request.nextUrl.searchParams;
    const producto = /^[0-9a-f-]{36}$/i.test(sp.get("producto") ?? "") ? sp.get("producto")! : "";
    const deposito = /^[0-9a-f-]{36}$/i.test(sp.get("deposito") ?? "") ? sp.get("deposito")! : "";
    // Depósito, documento y saldo existen desde la migración de inventario por depósito
    // (solo `neura`). En otro schema se sigue con la consulta de siempre.
    const conDepositos = schema === "neura";
    const tU = quoteSchemaTable(schema, "inventario_ubicaciones");
    const { rows } = await queryWithRetry(pool,
      conDepositos
        ? `SELECT m.id, m.empresa_id, m.producto_id, m.producto_nombre, m.producto_sku,
                  m.tipo, m.cantidad, m.costo_unitario, m.origen, m.referencia, m.fecha, m.created_at, m.updated_at,
                  m.created_by, m.usuario_nombre, m.ubicacion_id, u.nombre AS ubicacion_nombre,
                  c.nombre AS contraparte_nombre, m.documento_tipo, m.documento_id, m.documento_numero,
                  m.saldo_deposito
             FROM ${t} m
             LEFT JOIN ${tU} u ON u.id = m.ubicacion_id
             LEFT JOIN ${tU} c ON c.id = m.ubicacion_contraparte_id
            WHERE m.empresa_id = $1::uuid
              AND ($2 = '' OR m.producto_id = NULLIF($2, '')::uuid)
              AND ($3 = '' OR m.ubicacion_id = NULLIF($3, '')::uuid)
            ORDER BY m.fecha DESC, m.created_at DESC
            LIMIT 1000`
        : `SELECT id, empresa_id, producto_id, producto_nombre, producto_sku,
                  tipo, cantidad, costo_unitario, origen, referencia, fecha, created_at, updated_at,
                  created_by, usuario_nombre
             FROM ${t}
            WHERE empresa_id = $1::uuid
              AND ($2 = '' OR producto_id = NULLIF($2, '')::uuid)
              AND ($3 = '' OR $3 = $3)
            ORDER BY fecha DESC
            LIMIT 500`,
      [empresaId, producto, deposito]
    );
    return NextResponse.json(successResponse({ movimientos: rows }));
  } catch (err) {
    console.error("[/api/inventario/movimientos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los movimientos."), { status: 500 });
  }
}
