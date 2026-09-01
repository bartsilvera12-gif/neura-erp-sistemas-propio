import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireTenantUserApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";

export const runtime = "nodejs";

/**
 * GET /api/monitoreo/leads-del-dia?fecha=YYYY-MM-DD
 * Lista los LEADS del día (prospectos CRM creados ese día, hora Paraguay) con su
 * conversación, para que el dueño/supervisor los lea de corrido desde el Monitoreo.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTenantUserApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const fecha = (request.nextUrl.searchParams.get("fecha") || "").trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json(errorResponse("Fecha inválida (YYYY-MM-DD)"), { status: 400 });
    }
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(auth.empresaId));
    const pool = getChatPostgresPool();
    if (!pool) return NextResponse.json(errorResponse("Conexión no disponible."), { status: 500 });

    const tP = quoteSchemaTable(schema, "crm_prospectos");
    const tC = quoteSchemaTable(schema, "chat_contacts");
    const tCv = quoteSchemaTable(schema, "chat_conversations");
    const tA = quoteSchemaTable(schema, "chat_conversation_attribution");

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (cv.id)
              cv.id AS conversation_id,
              ct.name AS nombre,
              ct.phone_number AS telefono,
              cv.created_at,
              cv.last_message_at,
              cv.last_message_preview,
              cv.status,
              a.meta_campaign_name AS campania
         FROM ${tP} p
         JOIN ${tC} ct ON ct.crm_prospecto_id = p.id AND ct.empresa_id = p.empresa_id
         JOIN ${tCv} cv ON cv.contact_id = ct.id
         LEFT JOIN ${tA} a ON a.conversation_id = cv.id
        WHERE p.empresa_id = $1::uuid
          AND (p.created_at AT TIME ZONE 'America/Asuncion')::date = $2::date
        ORDER BY cv.id, cv.last_message_at DESC NULLS LAST`,
      [auth.empresaId, fecha]
    );

    // Orden final por actividad reciente (el DISTINCT ON obliga a ordenar por cv.id primero).
    const leads = [...rows].sort((x, y) => {
      const tx = x.last_message_at ? new Date(String(x.last_message_at)).getTime() : 0;
      const ty = y.last_message_at ? new Date(String(y.last_message_at)).getTime() : 0;
      return ty - tx;
    });

    return NextResponse.json(successResponse({ leads, total: leads.length }));
  } catch (e) {
    console.error("[/api/monitoreo/leads-del-dia]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudieron cargar los leads del día."), { status: 500 });
  }
}
