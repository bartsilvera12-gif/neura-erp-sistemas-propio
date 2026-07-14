"use server";

import {
  pgChannelBelongsToEmpresa,
  pgListActiveQuickRepliesForChannel,
  pgListAllQuickRepliesForChannel,
  pgCreateQuickReply,
  pgUpdateQuickReply,
  pgDeleteQuickReply,
} from "@/lib/chat/chat-quick-replies-pg";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { useChatPgForTenantSchema } from "@/lib/supabase/chat-data-schema";

export type ChannelQuickReplyRow = {
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

async function assertChannelBelongsToEmpresa(
  supabase: Awaited<ReturnType<typeof requireEmpresaTenantServiceRole>>["supabase"],
  empresaId: string,
  channelId: string
) {
  const { data, error } = await supabase
    .from("chat_channels")
    .select("id")
    .eq("id", channelId.trim())
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Canal no encontrado o sin permiso.");
}

/** Listado para inbox: solo activas, ordenadas. */
export async function listActiveQuickRepliesForChannel(channelId: string): Promise<ChannelQuickReplyRow[]> {
  const { supabase, empresa_id, dataSchema } = await requireEmpresaTenantServiceRole();
  const cid = channelId.trim();
  if (!cid) return [];

  const pool = getChatPostgresPool();
  if (pool && useChatPgForTenantSchema(dataSchema)) {
    const ok = await pgChannelBelongsToEmpresa(pool, dataSchema, empresa_id, cid);
    if (!ok) throw new Error("Canal no encontrado o sin permiso.");
    const rows = await pgListActiveQuickRepliesForChannel(pool, dataSchema, empresa_id, cid);
    return rows as ChannelQuickReplyRow[];
  }

  await assertChannelBelongsToEmpresa(supabase, empresa_id, cid);

  const { data, error } = await supabase
    .from("chat_channel_quick_replies")
    .select(
      "id, empresa_id, channel_id, title, body, sort_order, is_active, created_at, updated_at"
    )
    .eq("empresa_id", empresa_id)
    .eq("channel_id", cid)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ChannelQuickReplyRow[];
}

/** Gestión en configuración: todas las filas. */
export async function listAllQuickRepliesForChannel(channelId: string): Promise<ChannelQuickReplyRow[]> {
  const { supabase, empresa_id, dataSchema } = await requireEmpresaTenantServiceRole();
  const cid = channelId.trim();
  if (!cid) return [];

  const pool = getChatPostgresPool();
  if (pool && useChatPgForTenantSchema(dataSchema)) {
    const ok = await pgChannelBelongsToEmpresa(pool, dataSchema, empresa_id, cid);
    if (!ok) throw new Error("Canal no encontrado o sin permiso.");
    return (await pgListAllQuickRepliesForChannel(pool, dataSchema, empresa_id, cid)) as ChannelQuickReplyRow[];
  }

  await assertChannelBelongsToEmpresa(supabase, empresa_id, cid);

  const { data, error } = await supabase
    .from("chat_channel_quick_replies")
    .select(
      "id, empresa_id, channel_id, title, body, sort_order, is_active, created_at, updated_at"
    )
    .eq("empresa_id", empresa_id)
    .eq("channel_id", cid)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ChannelQuickReplyRow[];
}

export async function createChannelQuickReply(input: {
  channelId: string;
  title: string;
  body: string;
  sortOrder?: number;
}): Promise<void> {
  const { supabase, empresa_id, dataSchema } = await requireEmpresaTenantServiceRole();
  const channelId = input.channelId.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!channelId || !title || !body) throw new Error("Completá título y texto.");
  const sortOrder = typeof input.sortOrder === "number" ? input.sortOrder : 0;

  const pool = getChatPostgresPool();
  const usePg = Boolean(pool) && useChatPgForTenantSchema(dataSchema);

  // ── DIAG TEMPORAL: hace el insert por el camino elegido y luego LANZA el resultado a la UI
  //    (schema, camino, pool, y cuántas filas hay tras insertar) para diagnosticar sin depender de logs.
  let pgErr: string | null = null;
  let pgInserted = false;
  let postgrestErr: string | null = null;
  let postgrestInsertedCount = -1;

  if (usePg && pool) {
    try {
      const ok = await pgChannelBelongsToEmpresa(pool, dataSchema, empresa_id, channelId);
      if (!ok) throw new Error("Canal no pertenece a la empresa (PG).");
      await pgCreateQuickReply(pool, dataSchema, empresa_id, { channelId, title, body, sortOrder });
      pgInserted = true;
    } catch (e) {
      pgErr = e instanceof Error ? e.message : String(e);
    }
  } else {
    try {
      const { data: inserted, error } = await supabase
        .from("chat_channel_quick_replies")
        .insert({ empresa_id, channel_id: channelId, title, body, sort_order: sortOrder, is_active: true })
        .select("id");
      postgrestErr = error?.message ?? null;
      postgrestInsertedCount = inserted?.length ?? 0;
    } catch (e) {
      postgrestErr = e instanceof Error ? e.message : String(e);
    }
  }

  // Cuenta real tras el intento (por PG directo, que sabemos que lee bien).
  let countAfter = -1;
  try {
    if (pool) countAfter = (await pgListAllQuickRepliesForChannel(pool, dataSchema, empresa_id, channelId)).length;
  } catch { /* ignore */ }

  throw new Error(
    `DIAG → schema=${dataSchema} | pool=${Boolean(pool)} | usePg=${usePg} | ` +
    (usePg ? `pgInserted=${pgInserted} pgErr=${pgErr ?? "-"}` : `postgrestCount=${postgrestInsertedCount} postgrestErr=${postgrestErr ?? "-"}`) +
    ` | countAfter=${countAfter}`
  );
}

export async function updateChannelQuickReply(input: {
  id: string;
  title?: string;
  body?: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<void> {
  const { supabase, empresa_id, dataSchema } = await requireEmpresaTenantServiceRole();
  const id = input.id.trim();
  if (!id) throw new Error("ID inválido.");

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) throw new Error("El título no puede quedar vacío.");
    patch.title = t;
  }
  if (input.body !== undefined) {
    const b = input.body.trim();
    if (!b) throw new Error("El texto no puede quedar vacío.");
    patch.body = b;
  }
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  if (Object.keys(patch).length === 0) return;

  const pool = getChatPostgresPool();
  if (pool && useChatPgForTenantSchema(dataSchema)) {
    const okRow = await pgUpdateQuickReply(pool, dataSchema, empresa_id, id, {
      title: patch.title as string | undefined,
      body: patch.body as string | undefined,
      sortOrder: patch.sort_order as number | undefined,
      isActive: patch.is_active as boolean | undefined,
    });
    if (!okRow) throw new Error("Respuesta rápida no encontrada.");
    return;
  }

  const { data: existing, error: exErr } = await supabase
    .from("chat_channel_quick_replies")
    .select("id")
    .eq("id", id)
    .eq("empresa_id", empresa_id)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);
  if (!existing) throw new Error("Respuesta rápida no encontrada.");

  const { error } = await supabase.from("chat_channel_quick_replies").update(patch).eq("id", id).eq(
    "empresa_id",
    empresa_id
  );

  if (error) throw new Error(error.message);
}

export async function deleteChannelQuickReply(id: string): Promise<void> {
  const { supabase, empresa_id, dataSchema } = await requireEmpresaTenantServiceRole();
  const rid = id.trim();
  if (!rid) throw new Error("ID inválido.");

  const pool = getChatPostgresPool();
  if (pool && useChatPgForTenantSchema(dataSchema)) {
    await pgDeleteQuickReply(pool, dataSchema, empresa_id, rid);
    return;
  }

  const { error } = await supabase
    .from("chat_channel_quick_replies")
    .delete()
    .eq("id", rid)
    .eq("empresa_id", empresa_id);

  if (error) throw new Error(error.message);
}
