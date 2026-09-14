import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import {
  resolveOutboundTextContextFromIds,
  type ChannelOutboundTextContext,
} from "@/lib/chat/outbound-send-dispatch";
import type { SendWhatsAppTextResult } from "@/lib/chat/whatsapp-send-service";
import { sendYCloudWhatsappReaction } from "@/lib/chat/ycloud-send-service";
import { EMOJIS_REACCION } from "@/lib/chat/message-reactions";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";

export const runtime = "nodejs";

/**
 * POST /api/chat/react
 * Body: { conversation_id, target_wa_message_id, emoji }  — `emoji: ""` quita la reacción.
 *
 * Reacciona con un emoji a un mensaje. Se persiste como una fila `message_type: "reaction"`,
 * la MISMA forma con la que ya llegaban las reacciones de los clientes, así el chat las
 * agrupa por igual sin importar quién reaccionó.
 *
 * Alcance: canales YCloud sobre tenants servidos por PostgREST, igual que send-sticker. Los
 * demás responden con error explícito en vez de un camino a medias.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { conversation_id?: string; target_wa_message_id?: string; emoji?: string }
      | null;
    const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id.trim() : "";
    const target = typeof body?.target_wa_message_id === "string" ? body.target_wa_message_id.trim() : "";
    const emoji = typeof body?.emoji === "string" ? body.emoji.trim() : "";
    if (!conversationId || !target) {
      return NextResponse.json(
        { ok: false, error: "Se requiere conversation_id y target_wa_message_id" },
        { status: 400 }
      );
    }
    // Lista cerrada: el emoji viaja hasta WhatsApp y termina guardado; no se acepta
    // texto arbitrario. La cadena vacía es válida porque es cómo se retira la reacción.
    if (emoji && !(EMOJIS_REACCION as readonly string[]).includes(emoji)) {
      return NextResponse.json({ ok: false, error: "Emoji no permitido" }, { status: 400 });
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const dataSchema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const pool = getChatPostgresPool();
    if (pool && isLikelyUnexposedTenantChatSchema(dataSchema)) {
      return NextResponse.json(
        { ok: false, error: "Las reacciones todavía no están disponibles para esta empresa" },
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

    let outboundCtx: ChannelOutboundTextContext;
    try {
      outboundCtx = await resolveOutboundTextContextFromIds(
        supabase,
        { contactId: conv.contact_id, channelId: conv.channel_id },
        { dataSchema, empresaId: conv.empresa_id }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Datos de envío incompletos";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
    if (outboundCtx.provider !== "ycloud") {
      return NextResponse.json(
        { ok: false, error: "Las reacciones sólo funcionan en canales de WhatsApp vía YCloud" },
        { status: 400 }
      );
    }
    if (!outboundCtx.toDigits) {
      return NextResponse.json({ ok: false, error: "Falta teléfono del contacto" }, { status: 400 });
    }

    const sendResult: SendWhatsAppTextResult = await sendYCloudWhatsappReaction({
      apiKey: outboundCtx.apiKey,
      fromE164: outboundCtx.fromE164,
      toDigits: outboundCtx.toDigits,
      targetWamid: target,
      emoji,
    });
    if (!sendResult.ok) {
      const err = sendResult.error || "No se pudo reaccionar";
      const status = sendResult.code === "sin_wamid" ? 400 : 502;
      return NextResponse.json({ ok: false, error: err, code: sendResult.code }, { status });
    }

    const raw = (sendResult as { raw?: unknown }).raw;
    const { error: insErr } = await supabase.from("chat_messages").insert({
      empresa_id: conv.empresa_id,
      conversation_id: conversationId,
      wa_message_id: sendResult.waMessageId,
      from_me: true,
      sender_type: "human",
      sent_by_user_id: auth.user.id,
      sent_by_user_name: auth.nombre ?? auth.user.email ?? null,
      message_type: "reaction",
      content: emoji || null,
      raw_payload: {
        ...(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}),
        // Fuente propia y estable: no dependemos de adivinar dónde deja YCloud el destino.
        erp_reaction: { target_wamid: target, emoji },
      } as Record<string, unknown>,
    });
    if (insErr) {
      console.warn("[api/chat/react] no se persistió la reacción", insErr.message);
    }

    // NO se toca `last_message_at` ni la vista previa de la conversación: una reacción no
    // debe subir el chat en la bandeja como si hubiera un mensaje nuevo.
    return NextResponse.json({ ok: true, emoji });
  } catch (e) {
    console.error("[api/chat/react]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
