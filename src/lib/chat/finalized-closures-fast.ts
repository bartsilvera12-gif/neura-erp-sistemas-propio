import "server-only";

/**
 * El reporte de cierres, en UNA consulta.
 *
 * El camino histórico (PostgREST) resuelve el alcance trayendo hasta 15.000
 * ids de conversación y metiéndolos en un `IN (...)`. Con un comercial que
 * acumula miles de chats cerrados eso arma URLs enormes —el mismo problema que
 * ya nos rompió otras pantallas— y obliga a paginar en memoria.
 *
 * Acá el alcance, los filtros, la búsqueda, el orden, la página y el total se
 * resuelven en una sola consulta SQL. Se usa cuando hay conexión directa a
 * Postgres; si no la hay, el llamador se queda con el camino de siempre.
 *
 * El alcance NO se relaja: un asesor sigue viendo únicamente las
 * conversaciones que tuvo asignadas, y eso se hace en el `WHERE`, no en el
 * cliente.
 */

import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import type {
  FinalizedClosureListRow,
  FinalizedClosuresFilters,
  FinalizedClosuresListResult,
} from "@/lib/chat/finalized-closures-actions";

export type AlcanceCierres =
  | { tipo: "todo" }
  /** Sólo las conversaciones asignadas a estos `chat_agents.id`. */
  | { tipo: "agentes"; chatAgentIds: string[] };

function inicioDelDia(fecha: string): string {
  return `${fecha}T00:00:00.000Z`;
}
function finDelDia(fecha: string): string {
  return `${fecha}T23:59:59.999Z`;
}

export async function listarCierresRapido(
  pool: Pool,
  schema: string,
  empresaId: string,
  alcance: AlcanceCierres,
  filtros: FinalizedClosuresFilters,
  pagina: number,
  porPagina: number
): Promise<FinalizedClosuresListResult> {
  const T = (t: string) => quoteSchemaTable(schema, t);
  const sinTildes = quoteSchemaTable(schema, "sin_tildes");

  const cond: string[] = ["cl.empresa_id = $1::uuid"];
  const params: unknown[] = [empresaId];
  let i = 2;

  if (alcance.tipo === "agentes") {
    if (alcance.chatAgentIds.length === 0) {
      return { rows: [], total: 0, page: pagina, page_size: porPagina };
    }
    cond.push(`co.assigned_agent_id = ANY($${i}::uuid[])`);
    params.push(alcance.chatAgentIds);
    i++;
  }

  const agregar = (sql: string, valor: unknown) => {
    cond.push(sql.replace("$?", `$${i}`));
    params.push(valor);
    i++;
  };

  const df = filtros.date_from?.trim();
  if (df) agregar("cl.closed_at >= $?::timestamptz", inicioDelDia(df));
  const dt = filtros.date_to?.trim();
  if (dt) agregar("cl.closed_at <= $?::timestamptz", finDelDia(dt));

  const cola = filtros.queue_id?.trim();
  if (cola) agregar("cl.queue_id = $?::uuid", cola);

  const estado = filtros.state_label?.trim();
  if (estado) agregar("cl.closure_state_label = $?", estado);

  const sub = filtros.substate_label?.trim();
  if (sub) agregar("cl.closure_substate_label = $?", sub);

  const cerroPor = filtros.closed_by_usuario_id?.trim();
  if (cerroPor) agregar("cl.closed_by_usuario_id = $?::uuid", cerroPor);

  const canal = filtros.channel_id?.trim();
  if (canal) agregar("co.channel_id = $?::uuid", canal);

  const asignadoA = filtros.assigned_usuario_id?.trim();
  if (asignadoA) agregar("ag.usuario_id = $?::uuid", asignadoA);

  // Búsqueda por nombre o número, sin tildes y por palabras en AND: cada
  // palabra que se agrega acota, que es lo que uno espera al seguir escribiendo.
  const q = filtros.q?.trim();
  if (q) {
    for (const palabra of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
      const idx = i;
      params.push(`%${palabra}%`);
      i++;
      const digitos = palabra.replace(/\D/g, "");
      let porTelefono = "";
      if (digitos.length >= 3) {
        porTelefono = ` OR ct.phone_number LIKE $${i} OR ct.phone_normalized LIKE $${i}`;
        params.push(`%${digitos}%`);
        i++;
      }
      cond.push(
        `(${sinTildes}(ct.name) LIKE ${sinTildes}($${idx})${porTelefono})`
      );
    }
  }

  const offset = (Math.max(1, pagina) - 1) * porPagina;
  params.push(porPagina, offset);

  const sql = `
    SELECT cl.id::text                       AS closure_id,
           cl.conversation_id::text          AS conversation_id,
           cl.closed_at,
           ct.name                           AS contact_name,
           COALESCE(ct.phone_number, '')     AS phone_number,
           COALESCE(ch.channel_type, '')     AS channel_type,
           ch.nombre                         AS channel_nombre,
           qu.nombre                         AS queue_nombre,
           ua.nombre                         AS assigned_agent_nombre,
           uc.nombre                         AS closed_by_nombre,
           COALESCE(cl.closure_state_label, '')     AS state_label,
           COALESCE(cl.closure_substate_label, '')  AS substate_label,
           COALESCE(cl.comment, '')          AS comment,
           co.last_message_preview           AS last_preview,
           count(*) OVER ()                  AS total
      FROM ${T("chat_conversation_closures")} cl
      JOIN ${T("chat_conversations")} co ON co.id = cl.conversation_id
      LEFT JOIN ${T("chat_contacts")} ct  ON ct.id = co.contact_id
      LEFT JOIN ${T("chat_channels")} ch  ON ch.id = co.channel_id
      LEFT JOIN ${T("chat_queues")} qu    ON qu.id = cl.queue_id
      LEFT JOIN ${T("chat_agents")} ag    ON ag.id = co.assigned_agent_id
      LEFT JOIN ${T("usuarios")} ua       ON ua.id = ag.usuario_id
      LEFT JOIN ${T("usuarios")} uc       ON uc.id = cl.closed_by_usuario_id
     WHERE ${cond.join("\n       AND ")}
     ORDER BY cl.closed_at DESC
     LIMIT $${i} OFFSET $${i + 1}`;

  const r = await pool.query(sql, params);
  const filas = (r.rows ?? []) as Record<string, unknown>[];

  // `count(*) OVER ()` viene en cada fila; sin filas, el total es cero.
  const total = filas.length > 0 ? Number(filas[0].total ?? 0) : 0;

  const rows: FinalizedClosureListRow[] = filas.map((f) => ({
    closure_id: String(f.closure_id ?? ""),
    conversation_id: String(f.conversation_id ?? ""),
    closed_at:
      f.closed_at instanceof Date
        ? f.closed_at.toISOString()
        : String(f.closed_at ?? ""),
    contact_name: (f.contact_name as string | null) ?? null,
    phone_number: String(f.phone_number ?? ""),
    channel_type: String(f.channel_type ?? ""),
    channel_nombre: (f.channel_nombre as string | null) ?? null,
    queue_nombre: (f.queue_nombre as string | null) ?? null,
    assigned_agent_nombre: (f.assigned_agent_nombre as string | null) ?? null,
    closed_by_nombre: (f.closed_by_nombre as string | null) ?? null,
    state_label: String(f.state_label ?? ""),
    substate_label: String(f.substate_label ?? ""),
    comment: String(f.comment ?? ""),
    last_preview: (f.last_preview as string | null) ?? null,
  }));

  return { rows, total, page: Math.max(1, pagina), page_size: porPagina };
}
