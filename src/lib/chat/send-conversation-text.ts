import "server-only";
import type { Pool } from "pg";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  resolveOutboundTextContextFromIds,
  resolveBaileysContextFromIds,
  sendOutboundTextMessage,
  sendTextViaBaileysBridge,
} from "@/lib/chat/outbound-send-dispatch";
import { resolveMetaMessagingSendContext, sendMetaMessagingText } from "@/lib/chat/meta-messaging-send-service";
import { pgInsertChatMessageOutbound, pgTouchConversationLastMessage } from "@/lib/chat/chat-send-persist-pg";

export type SendConversationTextParams = {
  supabase: AppSupabaseClient;
  pool: Pool | null;
  /** true = schema tenant no expuesto (persistir por PG directo); false = supabase-js. */
  tenantPg: boolean;
  dataSchema: string;
  empresaId: string;
  conversationId: string;
  contactId: string;
  channelId: string;
  text: string;
  /** Por defecto "system" (mensaje automático del negocio, no atribuido a un agente). */
  senderType?: "system" | "ai" | "human";
  /** Etiqueta de origen para auditar el mensaje automático. */
  automationSource?: string | null;
};

export type SendConversationTextResult = { ok: boolean; waMessageId?: string | null; error?: string };

/**
 * Envía un texto en una conversación (WhatsApp Meta/YCloud, WhatsApp QR/Baileys o social Meta) y
 * lo persiste como mensaje SALIENTE. Reusa exactamente los mismos resolvers que `/api/chat/send`,
 * pero es BEST-EFFORT para usos automáticos (p. ej. el mensaje de derivación al transferir):
 * NUNCA lanza — devuelve `{ ok:false, error }` ante cualquier problema (config incompleta, ventana
 * de 24h de WhatsApp vencida, etc.), para no romper el flujo que lo invoca.
 */
export async function sendConversationText(p: SendConversationTextParams): Promise<SendConversationTextResult> {
  const text = (p.text ?? "").trim();
  if (!text) return { ok: false, error: "texto vacío" };
  const senderType = p.senderType ?? "system";
  const automationSource = p.automationSource ?? "derivacion";

  try {
    let sendResult: Awaited<ReturnType<typeof sendOutboundTextMessage>>;

    // Canal social (Messenger / Instagram Direct) → Graph API de Meta; si no es social, null.
    const metaMsg = await resolveMetaMessagingSendContext(p.supabase, {
      channelId: p.channelId,
      contactId: p.contactId,
    });
    if (metaMsg) {
      sendResult = await sendMetaMessagingText({
        type: metaMsg.type,
        pageId: metaMsg.pageId,
        accessToken: metaMsg.accessToken,
        recipientId: metaMsg.recipientId,
        text,
      });
    } else {
      // WhatsApp por QR (Baileys) → puente; si no es baileys, null.
      const baileys = await resolveBaileysContextFromIds(
        p.supabase,
        { contactId: p.contactId, channelId: p.channelId },
        { dataSchema: p.dataSchema, empresaId: p.empresaId }
      );
      if (baileys) {
        sendResult = await sendTextViaBaileysBridge(baileys.bridgeUrl, baileys.toDigits, text);
      } else {
        const outbound = await resolveOutboundTextContextFromIds(
          p.supabase,
          { contactId: p.contactId, channelId: p.channelId },
          { dataSchema: p.dataSchema, empresaId: p.empresaId }
        );
        sendResult = await sendOutboundTextMessage(outbound, text);
      }
    }

    if (!sendResult.ok) return { ok: false, error: sendResult.error };

    const ts = new Date().toISOString();
    const raw = (sendResult.raw ?? {}) as Record<string, unknown>;

    if (p.tenantPg && p.pool) {
      await pgInsertChatMessageOutbound(p.pool, p.dataSchema, {
        empresa_id: p.empresaId,
        conversation_id: p.conversationId,
        wa_message_id: sendResult.waMessageId ?? null,
        from_me: true,
        sender_type: senderType,
        sent_by_user_id: null,
        sent_by_user_name: null,
        automation_source: automationSource,
        message_type: "text",
        content: text,
        raw_payload: raw,
      });
      await pgTouchConversationLastMessage(p.pool, p.dataSchema, p.conversationId, ts, text);
    } else {
      const { error: insErr } = await p.supabase.from("chat_messages").insert({
        empresa_id: p.empresaId,
        conversation_id: p.conversationId,
        wa_message_id: sendResult.waMessageId ?? null,
        from_me: true,
        sender_type: senderType,
        sent_by_user_id: null,
        sent_by_user_name: null,
        automation_source: automationSource,
        message_type: "text",
        content: text,
        raw_payload: raw,
      });
      if (insErr) return { ok: true, waMessageId: sendResult.waMessageId ?? null, error: "enviado pero no guardado: " + insErr.message };
      await p.supabase
        .from("chat_conversations")
        .update({ last_message_at: ts, last_message_preview: text.slice(0, 280), updated_at: ts })
        .eq("id", p.conversationId);
    }

    return { ok: true, waMessageId: sendResult.waMessageId ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
