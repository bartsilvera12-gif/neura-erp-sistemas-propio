/**
 * Envío saliente por la Graph API de Meta para Messenger (Facebook) e Instagram Direct.
 *
 * Ambos usan el token de la página de Facebook vinculada y el endpoint
 * `POST /{PAGE_ID}/messages`. La ventana de 24h se maneja como en WhatsApp: no se
 * pre-bloquea; si el envío no corresponde, Meta devuelve el error real y se propaga.
 *
 * Devuelve la MISMA forma que `sendOutboundTextMessage` (WhatsApp) para poder
 * reutilizar tal cual la persistencia del mensaje saliente en `/api/chat/send`.
 */

import type { SupabaseAdmin } from "@/lib/chat/types";

const GRAPH_VERSION = "v21.0";

export type MetaMessagingSendContext = {
  type: "facebook" | "instagram";
  pageId: string;
  accessToken: string;
  recipientId: string;
};

/**
 * Resuelve el contexto de envío para un canal Messenger/Instagram a partir de la
 * conversación (canal + contacto). Devuelve `null` si el canal NO es social — así
 * el route sigue por el camino WhatsApp/Baileys de siempre.
 */
export async function resolveMetaMessagingSendContext(
  supabase: SupabaseAdmin,
  ids: { channelId: string; contactId: string }
): Promise<MetaMessagingSendContext | null> {
  const { data: ch } = await supabase
    .from("chat_channels")
    .select("type, provider_channel_id, config")
    .eq("id", ids.channelId)
    .maybeSingle();
  const channel = ch as
    | { type?: string; provider_channel_id?: string | null; config?: unknown }
    | null;
  const type = String(channel?.type ?? "").trim().toLowerCase();
  if (type !== "facebook" && type !== "instagram") return null;

  const cfg =
    channel?.config && typeof channel.config === "object" && !Array.isArray(channel.config)
      ? (channel.config as Record<string, unknown>)
      : {};
  const pageId =
    String(cfg.page_id ?? "").trim() || String(channel?.provider_channel_id ?? "").trim();
  const accessToken = String(cfg.page_access_token ?? "").trim();

  const { data: ct } = await supabase
    .from("chat_contacts")
    .select("phone_number")
    .eq("id", ids.contactId)
    .maybeSingle();
  const recipientId = String((ct as { phone_number?: string } | null)?.phone_number ?? "").trim();

  return { type: type as "facebook" | "instagram", pageId, accessToken, recipientId };
}

/** Misma forma discriminada que `SendWhatsAppTextResult`, para reusar la persistencia del route. */
export type MetaMessagingSendResult =
  | { ok: true; waMessageId: string | null; raw: unknown }
  | { ok: false; error: string; raw?: unknown };

export type SendMetaMessagingTextInput = {
  /** Page ID de Facebook (para Messenger e Instagram, la página vinculada). */
  pageId: string;
  /** Page access token de larga duración. */
  accessToken: string;
  /** PSID (Messenger) o IGSID (Instagram) del destinatario. */
  recipientId: string;
  text: string;
};

export async function sendMetaMessagingText(
  input: SendMetaMessagingTextInput
): Promise<MetaMessagingSendResult> {
  const pageId = input.pageId.trim();
  const token = input.accessToken.trim();
  const recipient = input.recipientId.trim();
  const text = input.text;

  if (!pageId || !token) {
    return { ok: false, error: "Canal sin page_id o page_access_token. Revisá la configuración del canal." };
  }
  if (!recipient) {
    return { ok: false, error: "Destinatario sin identificador (PSID/IGSID)." };
  }
  if (!text.trim()) {
    return { ok: false, error: "Mensaje vacío." };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/messages`;
  const payload = {
    recipient: { id: recipient },
    messaging_type: "RESPONSE",
    message: { text },
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const raw = (await r.json().catch(() => ({}))) as Record<string, unknown>;

    if (!r.ok || raw.error) {
      const err = raw.error as { message?: string; code?: number } | undefined;
      const message = err?.message || `Meta respondió ${r.status}`;
      return { ok: false, error: message, raw };
    }

    const messageId = typeof raw.message_id === "string" ? raw.message_id : null;
    return { ok: true, waMessageId: messageId, raw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red enviando a Meta" };
  }
}
