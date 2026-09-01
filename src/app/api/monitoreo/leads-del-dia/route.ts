import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireTenantUserApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/monitoreo/leads-del-dia?fecha=YYYY-MM-DD&agentId=<chat_agents.id>
 * Chats asignados a un asesor ese día (hora Paraguay), para leerlos desde el Monitor.
 * El anclaje temporal es la fecha de asignación (initial_assignment_at) con fallback a
 * created_at, para calzar con la columna "Leads hoy" (reparto del día por agente).
 */
export async function GET(request: NextRequest) {
  const auth = await requireTenantUserApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const fecha = (request.nextUrl.searchParams.get("fecha") || "").trim() || new Date().toISOString().slice(0, 10);
    const agentId = (request.nextUrl.searchParams.get("agentId") || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json(errorResponse("Fecha inválida (YYYY-MM-DD)"), { status: 400 });
    }
    if (!UUID_RE.test(agentId)) {
      return NextResponse.json(errorResponse("agentId requerido"), { status: 400 });
    }
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(auth.empresaId));
    const pool = getChatPostgresPool();
    if (!pool) return NextResponse.json(errorResponse("Conexión no disponible."), { status: 500 });

    const tCv = quoteSchemaTable(schema, "chat_conversations");
    const tC = quoteSchemaTable(schema, "chat_contacts");
    const tA = quoteSchemaTable(schema, "chat_conversation_attribution");

    const { rows } = await pool.query(
      `SELECT cv.id AS conversation_id,
              ct.name AS nombre,
              ct.phone_number AS telefono,
              cv.created_at,
              cv.initial_assignment_at,
              cv.last_message_at,
              cv.last_message_preview,
              cv.status,
              a.meta_campaign_name AS campania
         FROM ${tCv} cv
         JOIN ${tC} ct ON ct.id = cv.contact_id
         LEFT JOIN ${tA} a ON a.conversation_id = cv.id
        WHERE cv.empresa_id = $1::uuid
          AND cv.assigned_agent_id = $3::uuid
          AND (COALESCE(cv.initial_assignment_at, cv.created_at) AT TIME ZONE 'America/Asuncion')::date = $2::date
        ORDER BY cv.last_message_at DESC NULLS LAST`,
      [auth.empresaId, fecha, agentId]
    );

    return NextResponse.json(successResponse({ leads: rows, total: rows.length }));
  } catch (e) {
    console.error("[/api/monitoreo/leads-del-dia]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudieron cargar los chats del asesor."), { status: 500 });
  }
}
