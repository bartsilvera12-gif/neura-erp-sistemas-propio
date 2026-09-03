import { saveIncomingMessage, type ChatChannelType } from "@/lib/chat/incoming-message-service";
import { resolveMetaMessagingChannel } from "@/lib/chat/webhooks/meta-messaging-resolve-channel";

/**
 * Traduce el webhook de mensajería de Meta (Messenger + Instagram Direct) a la
 * entrada omnicanal central (`saveIncomingMessage`). Mismo destino que WhatsApp:
 * contacto + conversación + mensaje en `chat_*`.
 *
 * Forma del payload (Messenger Platform / Instagram Messaging):
 *   { object: "page" | "instagram",
 *     entry: [ { id: <PAGE_ID|IG_ID>, messaging: [ { sender, recipient, timestamp, message|postback } ] } ] }
 *
 * `entry[].id` identifica la página / cuenta IG → resuelve el canal y su empresa.
 */

export type MetaMessagingResult = {
  ok: boolean;
  processed: number;
  skipped: number;
  errors: string[];
};

const GRAPH_VERSION = "v21.0";

type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
  };
  postback?: { mid?: string; payload?: string; title?: string };
  read?: unknown;
  delivery?: unknown;
};

type Entry = { id?: string; time?: number; messaging?: MessagingEvent[] };

/** "page" → facebook (Messenger); "instagram" → instagram (IG Direct). */
function objectToChannelType(object: string): ChatChannelType | null {
  const o = object.trim().toLowerCase();
  if (o === "page") return "facebook";
  if (o === "instagram") return "instagram";
  return null;
}

/** Nombre visible del contacto (best-effort vía Graph API; nunca corta el flujo). */
async function fetchProfileName(
  userId: string,
  pageAccessToken: string,
  type: ChatChannelType
): Promise<string | null> {
  if (!pageAccessToken) return null;
  try {
    const host = type === "instagram" ? "graph.instagram.com" : "graph.facebook.com";
    const fields = type === "instagram" ? "name,username" : "name";
    const url = `https://${host}/${GRAPH_VERSION}/${encodeURIComponent(
      userId
    )}?fields=${fields}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) return null;
    const j = (await r.json()) as { name?: string; username?: string };
    return (j.name || j.username || "").trim() || null;
  } catch {
    return null;
  }
}

/** Deriva tipo/contenido/id de un evento de mensajería. `null` = ignorar (read/delivery). */
function deriveMessage(ev: MessagingEvent): {
  messageType: string;
  content: string | null;
  externalId: string;
} | null {
  const ts = ev.timestamp ?? Date.now();

  if (ev.message) {
    const m = ev.message;
    const externalId = m.mid || `${ev.sender?.id ?? "?"}:${ts}:msg`;
    if (typeof m.text === "string" && m.text.length > 0) {
      return { messageType: "text", content: m.text, externalId };
    }
    const att = m.attachments?.[0];
    if (att) {
      const kind = (att.type || "archivo").toLowerCase();
      const url = att.payload?.url;
      const etiqueta =
        kind === "image" ? "📷 Imagen" : kind === "video" ? "🎥 Video" : kind === "audio" ? "🎧 Audio" : "📎 Adjunto";
      return { messageType: kind, content: url ? `${etiqueta} — ${url}` : etiqueta, externalId };
    }
    // Mensaje sin texto ni adjunto reconocible (sticker, etc.).
    return { messageType: "text", content: "[mensaje sin contenido de texto]", externalId };
  }

  if (ev.postback) {
    const externalId = ev.postback.mid || `${ev.sender?.id ?? "?"}:${ts}:postback`;
    const content = ev.postback.title || ev.postback.payload || "[interacción]";
    return { messageType: "text", content, externalId };
  }

  return null; // read / delivery / otros
}

export async function processMetaMessagingWebhookBody(body: unknown): Promise<MetaMessagingResult> {
  const result: MetaMessagingResult = { ok: true, processed: 0, skipped: 0, errors: [] };

  const b = body as { object?: string; entry?: Entry[] } | null;
  const type = objectToChannelType(String(b?.object ?? ""));
  if (!type) {
    result.skipped += 1;
    return result; // no es un webhook de mensajería que manejemos
  }

  const entries = Array.isArray(b?.entry) ? b!.entry! : [];
  for (const entry of entries) {
    const targetId = String(entry.id ?? "").trim();
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    if (!targetId || events.length === 0) {
      result.skipped += 1;
      continue;
    }

    const channel = await resolveMetaMessagingChannel(targetId, type);
    if (!channel) {
      result.skipped += events.length;
      result.errors.push(`canal_no_resuelto:${type}:${targetId}`);
      continue;
    }

    const pageToken = String(channel.config.page_access_token ?? "").trim();

    for (const ev of events) {
      if (ev.read || ev.delivery) {
        result.skipped += 1;
        continue;
      }

      const isEcho = ev.message?.is_echo === true;
      // Inbound: el que escribe es `sender`. Echo (respuesta hecha desde la app de
      // Meta): el mensaje va del negocio (`recipient` es el usuario).
      const userId = String((isEcho ? ev.recipient?.id : ev.sender?.id) ?? "").trim();
      if (!userId) {
        result.skipped += 1;
        continue;
      }

      const derived = deriveMessage(ev);
      if (!derived) {
        result.skipped += 1;
        continue;
      }

      let displayName: string | null = null;
      if (!isEcho) {
        displayName = await fetchProfileName(userId, pageToken, type);
      }

      const tsIso = new Date(ev.timestamp ?? Date.now()).toISOString();

      try {
        const saved = await saveIncomingMessage({
          supabase: channel.supabase,
          channel: { id: channel.channelId, empresa_id: channel.empresaId, type: channel.type },
          external_id: derived.externalId,
          contact_data: { address: userId, display_name: displayName },
          message_data: {
            message_type: derived.messageType,
            content: derived.content,
            raw_payload: ev as unknown as Record<string, unknown>,
            created_at: tsIso,
            from_me: isEcho,
            sender_type: isEcho ? "human" : "contact",
          },
        });

        if (saved.ok) {
          result.processed += 1;
        } else {
          result.skipped += 1;
          result.errors.push(saved.error);
        }
      } catch (e) {
        result.skipped += 1;
        result.errors.push(e instanceof Error ? e.message : "error_persist");
      }
    }
  }

  if (result.errors.length > 0) result.ok = result.processed > 0;
  return result;
}
