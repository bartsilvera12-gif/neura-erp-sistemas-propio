import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import type { SupabaseAdmin } from "@/lib/chat/types";
import type { ChatChannelType } from "@/lib/chat/incoming-message-service";

/**
 * Resolución de canal para el webhook de mensajería de Meta (Messenger / Instagram DM).
 *
 * Meta identifica el destino por el id de la página (Messenger) o de la cuenta IG
 * profesional (Instagram): viene en `entry[].id`. Buscamos el canal `chat_channels`
 * de tipo facebook/instagram cuyo `provider_channel_id` (o `config.page_id` /
 * `config.ig_id`) coincida, y devolvemos el cliente ya apuntando al schema de esa
 * empresa (mismo shim/PG que usa el resto del ERP).
 *
 * En instalaciones single-client (Neura) se puede fijar `META_MSG_EMPRESA_ID`
 * para no recorrer todas las empresas.
 */

export type MetaMessagingChannelConfig = {
  page_id?: string;
  ig_id?: string;
  instagram_id?: string;
  page_access_token?: string;
  [k: string]: unknown;
};

export type ResolvedMetaMessagingChannel = {
  empresaId: string;
  channelId: string;
  type: ChatChannelType;
  config: MetaMessagingChannelConfig;
  /** Cliente service-role apuntando al schema de datos de la empresa. */
  supabase: SupabaseAdmin;
};

type ChannelRow = {
  id: string;
  empresa_id: string;
  type: string;
  provider_channel_id: string | null;
  config: unknown;
  activo: boolean | null;
};

function asConfig(v: unknown): MetaMessagingChannelConfig {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as MetaMessagingChannelConfig) : {};
}

/** ¿Este canal corresponde al id de página / IG que llegó en el webhook? */
function channelMatchesTargetId(row: ChannelRow, targetId: string): boolean {
  const t = targetId.trim();
  if (!t) return false;
  if ((row.provider_channel_id ?? "").trim() === t) return true;
  const cfg = asConfig(row.config);
  return (
    String(cfg.page_id ?? "").trim() === t ||
    String(cfg.ig_id ?? "").trim() === t ||
    String(cfg.instagram_id ?? "").trim() === t
  );
}

/**
 * @param targetId  `entry[].id` del webhook (page id para Messenger, IG id para Instagram).
 * @param type      "facebook" o "instagram" según el `object` del webhook.
 */
export async function resolveMetaMessagingChannel(
  targetId: string,
  type: ChatChannelType
): Promise<ResolvedMetaMessagingChannel | null> {
  const id = targetId.trim();
  if (!id) return null;

  const catalog = createServiceRoleClient();
  const single = process.env.META_MSG_EMPRESA_ID?.trim();

  let empresaIds: string[] = [];
  if (single) {
    empresaIds = [single];
  } else {
    const { data, error } = await catalog.from("empresas").select("id");
    if (error) {
      console.warn("[webhooks/meta-msg] list_empresas", error.message);
      return null;
    }
    empresaIds = ((data ?? []) as { id: string }[]).map((e) => e.id).filter(Boolean);
  }

  for (const empresaId of empresaIds) {
    let supabase: SupabaseAdmin;
    try {
      supabase = (await getChatServiceClientForEmpresa(empresaId)) as unknown as SupabaseAdmin;
    } catch (e) {
      console.warn("[webhooks/meta-msg] cliente_empresa", { empresaId, error: e instanceof Error ? e.message : e });
      continue;
    }

    const { data, error } = await supabase
      .from("chat_channels")
      .select("id, empresa_id, type, provider_channel_id, config, activo")
      .eq("type", type)
      .eq("activo", true);
    if (error) {
      console.warn("[webhooks/meta-msg] canales", { empresaId, error: error.message });
      continue;
    }

    const rows = (data ?? []) as ChannelRow[];
    const match = rows.find((r) => channelMatchesTargetId(r, id));
    if (match) {
      return {
        empresaId,
        channelId: match.id,
        type,
        config: asConfig(match.config),
        supabase,
      };
    }
  }

  console.warn("[webhooks/meta-msg] canal_no_resuelto", { targetId: id, type });
  return null;
}
