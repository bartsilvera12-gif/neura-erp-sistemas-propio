import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { markFirstHumanOperatorReply } from "@/lib/chat/conversation-sla-markers";
import { getAuthWithRol } from "@/lib/middleware/auth";
import {
  resolveOutboundTextContextFromIds,
  type ChannelOutboundTextContext,
} from "@/lib/chat/outbound-send-dispatch";
import type { SendWhatsAppTextResult } from "@/lib/chat/whatsapp-send-service";
import { sendYCloudWhatsappMediaViaLink } from "@/lib/chat/ycloud-send-service";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";

export const runtime = "nodejs";

const CHAT_MEDIA_BUCKET = "chat-media";

/**
 * Sólo se envían stickers que ya viven en el bucket propio: los que mandó el ERP y
 * las copias de los recibidos (rehost). Evita que el endpoint sirva para mandar
 * cualquier link externo en nombre de la empresa.
 */
function esUrlDeStoragePropio(raw: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    const u = new URL(raw);
    const b = new URL(base);
    return (
      u.protocol === "https:" &&
      u.host === b.host &&
      u.pathname.startsWith(`/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/`)
    );
  } catch {
    return false;
  }
}

/** WhatsApp rechaza stickers que no son WebP o superan 500 KB; mejor avisar antes de enviar. */
async function verificarSticker(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { method: "HEAD", signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return "No se pudo acceder al sticker";
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("image/webp")) return "El sticker tiene que ser WebP";
    const len = Number(r.headers.get("content-length") || "0");
    if (len > 500_000) return "El sticker supera los 500 KB que permite WhatsApp";
    return null;
  } catch {
    return "No se pudo verificar el sticker";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /api/chat/send-sticker
 * Body JSON: { conversation_id, sticker_url }.
 * Reenvía por link un sticker WebP del storage propio (sin volver a subir nada) y lo
 * persiste como mensaje `sticker` con la misma forma de raw_payload.erp que send-media,
 * así el chat lo muestra con la rama de sticker existente.
 *
 * Alcance: canales YCloud y tenants servidos por PostgREST (neura). Tenants de pool PG y
 * canales Meta directos responden con error explícito en lugar de un camino a medias.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { conversation_id?: string; sticker_url?: string }
      | null;
    const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id.trim() : "";
    const stickerUrl = typeof body?.sticker_url === "string" ? body.sticker_url.trim() : "";
    if (!conversationId || !stickerUrl) {
      return NextResponse.json(
        { ok: false, error: "Se requiere conversation_id y sticker_url" },
        { status: 400 }
      );
    }
    if (!esUrlDeStoragePropio(stickerUrl)) {
      return NextResponse.json({ ok: false, error: "Sticker no válido" }, { status: 400 });
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const dataSchema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const pool = getChatPostgresPool();
    if (pool && isLikelyUnexposedTenantChatSchema(dataSchema)) {
      return NextResponse.json(
        { ok: false, error: "El envío de stickers todavía no está disponible para esta empresa" },
        { status: 501 }
      );
    }

    const { data: cdata, error: cErr } = await supabase
      .from("chat_conversations")
      .select("id, empresa_id, contact_id, channel_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (cErr || !cdata) {
      return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    }
    const conv = cdata as { empresa_id: string; contact_id: string; channel_id: string };
    if (conv.empresa_id !== auth.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
    }
    const empresaId = conv.empresa_id;

    let outboundCtx: ChannelOutboundTextContext;
    try {
      outboundCtx = await resolveOutboundTextContextFromIds(
        supabase,
        { contactId: conv.contact_id, channelId: conv.channel_id },
        { dataSchema, empresaId }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Datos de envío incompletos";
      let status = 400;
      if (msg.includes("desactivado")) status = 403;
      else if (msg.includes("token") || msg.includes("ycloud_api_key")) status = 500;
      return NextResponse.json({ ok: false, error: msg }, { status });
    }
    if (outboundCtx.provider !== "ycloud") {
      return NextResponse.json(
        { ok: false, error: "Los stickers sólo se pueden enviar por canales de WhatsApp vía YCloud" },
        { status: 400 }
      );
    }
    if (!outboundCtx.toDigits) {
      return NextResponse.json({ ok: false, error: "Falta teléfono del contacto" }, { status: 400 });
    }

    const problema = await verificarSticker(stickerUrl);
    if (problema) return NextResponse.json({ ok: false, error: problema }, { status: 400 });

    const sendResult: SendWhatsAppTextResult = await sendYCloudWhatsappMediaViaLink({
      apiKey: outboundCtx.apiKey,
      fromE164: outboundCtx.fromE164,
      toDigits: outboundCtx.toDigits,
      kind: "sticker",
      mediaLink: stickerUrl,
    });
    if (!sendResult.ok) {
      const err = sendResult.error || "No se pudo enviar el sticker";
      // Fuera de la ventana de 24 h WhatsApp sólo acepta plantillas (código 131047).
      const ventana = /131047|re-?engagement|24\s*h|ventana/i.test(err);
      return NextResponse.json(
        { ok: false, error: err, ...(ventana ? { code: "whatsapp_window_closed" } : {}) },
        { status: ventana ? 409 : 502 }
      );
    }

    const ts = new Date().toISOString();
    const raw = (sendResult as { raw?: unknown }).raw;
    const { error: insErr } = await supabase.from("chat_messages").insert({
      empresa_id: empresaId,
      conversation_id: conversationId,
      wa_message_id: sendResult.waMessageId,
      from_me: true,
      sender_type: "human",
      sent_by_user_id: auth.user.id,
      sent_by_user_name: auth.nombre ?? auth.user.email ?? null,
      message_type: "sticker",
      content: "Sticker",
      raw_payload: {
        ...(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}),
        erp: { public_url: stickerUrl, mime_type: "image/webp" },
      } as Record<string, unknown>,
    });
    if (insErr) {
      return NextResponse.json(
        { ok: false, error: "Enviado a WhatsApp pero no guardado: " + insErr.message },
        { status: 500 }
      );
    }

    await supabase
      .from("chat_conversations")
      .update({ last_message_at: ts, last_message_preview: "Sticker", updated_at: ts })
      .eq("id", conversationId);

    await markFirstHumanOperatorReply(supabase, empresaId, conversationId, {
      from_me: true,
      sender_type: "human",
    });

    return NextResponse.json({ ok: true, wa_message_id: sendResult.waMessageId });
  } catch (e) {
    console.error("[api/chat/send-sticker]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
