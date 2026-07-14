import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

/** Alineado a `ChannelQuickReplyRow` en quick-replies-actions (evita import circular). */
export type QuickReplyRowPg = {
  id: string;
  empresa_id: string;
  channel_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function pgChannelBelongsToEmpresa(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string
): Promise<boolean> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  try {
    const r = await pool.query(
      `SELECT 1 AS one FROM ${qt} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [channelId.trim(), empresaId]
    );
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

function mapQuickReplyRowPg(row: Record<string, unknown>): QuickReplyRowPg {
  return {
    id: String(row.id ?? ""),
    empresa_id: String(row.empresa_id ?? ""),
    channel_id: String(row.channel_id ?? ""),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    sort_order: Number(row.sort_order) || 0,
    is_active: row.is_active !== false,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ""),
  };
}

const QR_COLS =
  "id::text, empresa_id::text, channel_id::text, title, body, sort_order, is_active, created_at, updated_at";

export async function pgListActiveQuickRepliesForChannel(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string
): Promise<QuickReplyRowPg[]> {
  const qt = quoteSchemaTable(schema, "chat_channel_quick_replies");
  const r = await pool.query(
    `SELECT ${QR_COLS} FROM ${qt}
     WHERE empresa_id = $1::uuid AND channel_id = $2::uuid AND is_active = true
     ORDER BY sort_order ASC NULLS LAST, title ASC`,
    [empresaId, channelId.trim()]
  );
  return (r.rows ?? []).map(mapQuickReplyRowPg);
}

/** Config: TODAS las filas (activas e inactivas). */
export async function pgListAllQuickRepliesForChannel(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string
): Promise<QuickReplyRowPg[]> {
  const qt = quoteSchemaTable(schema, "chat_channel_quick_replies");
  const r = await pool.query(
    `SELECT ${QR_COLS} FROM ${qt}
     WHERE empresa_id = $1::uuid AND channel_id = $2::uuid
     ORDER BY sort_order ASC NULLS LAST, title ASC`,
    [empresaId, channelId.trim()]
  );
  return (r.rows ?? []).map(mapQuickReplyRowPg);
}

export async function pgCreateQuickReply(
  pool: Pool,
  schema: string,
  empresaId: string,
  input: { channelId: string; title: string; body: string; sortOrder: number }
): Promise<void> {
  const qt = quoteSchemaTable(schema, "chat_channel_quick_replies");
  await pool.query(
    `INSERT INTO ${qt} (empresa_id, channel_id, title, body, sort_order, is_active)
     VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::int, true)`,
    [empresaId, input.channelId.trim(), input.title, input.body, input.sortOrder]
  );
}

export async function pgUpdateQuickReply(
  pool: Pool,
  schema: string,
  empresaId: string,
  id: string,
  patch: { title?: string; body?: string; sortOrder?: number; isActive?: boolean }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (patch.title !== undefined) { sets.push(`title = $${i++}::text`); params.push(patch.title); }
  if (patch.body !== undefined) { sets.push(`body = $${i++}::text`); params.push(patch.body); }
  if (patch.sortOrder !== undefined) { sets.push(`sort_order = $${i++}::int`); params.push(patch.sortOrder); }
  if (patch.isActive !== undefined) { sets.push(`is_active = $${i++}::boolean`); params.push(patch.isActive); }
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  const qt = quoteSchemaTable(schema, "chat_channel_quick_replies");
  const q = `UPDATE ${qt} SET ${sets.join(", ")} WHERE id = $${i++}::uuid AND empresa_id = $${i++}::uuid`;
  params.push(id.trim(), empresaId);
  const r = await pool.query(q, params);
  return (r.rowCount ?? 0) > 0;
}

export async function pgDeleteQuickReply(
  pool: Pool,
  schema: string,
  empresaId: string,
  id: string
): Promise<void> {
  const qt = quoteSchemaTable(schema, "chat_channel_quick_replies");
  await pool.query(
    `DELETE FROM ${qt} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
    [id.trim(), empresaId]
  );
}
