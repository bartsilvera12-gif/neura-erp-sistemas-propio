/**
 * Webhook de entrada del canal WhatsApp QR (Baileys).
 *
 * Lo llama el "puente" (servicio Baileys aislado, ej. contenedor Coolify) cuando
 * llega un mensaje al número vinculado. Reusa la maquinaria omnicanal existente:
 *   - `saveIncomingMessage`  → contacto + conversación + mensaje (schema del tenant,
 *      vía shim PG para schemas no expuestos como `neura`).
 *   - Contact Center V1       → ventana 24h + asignación por equidad (misma RPC que YCloud).
 *
 * Seguridad: header `x-bridge-secret` debe coincidir con `BAILEYS_BRIDGE_SECRET`.
 *
 * Cuerpo esperado (JSON):
 *   { channelId, empresaId, fromDigits, waMessageId, messageKind, text, pushName, hasMedia, timestamp }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  saveIncomingMessage,
  isChatChannelType,
  type ChatChannelType,
} from "@/lib/chat/incoming-message-service";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import {
  contactCenterV1Enabled,
  applyInboundWindowAndAssignPg,
  applyInboundWindowAndAssignRest,
} from "@/lib/chat/contact-center-inbound";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import type { SupabaseAdmin } from "@/lib/chat/types";

export const dynamic = "force-dynamic";

const LOG = "[webhooks/baileys/inbound]";

/** Mapea el tipo de mensaje de Baileys al `message_type` del ERP + un preview. */
function mapKind(kind: string): { message_type: string; placeholder: string } {
  switch (kind) {
    case "conversation":
    case "extendedTextMessage":
      return { message_type: "text", placeholder: "" };
    case "imageMessage":
      return { message_type: "image", placeholder: "[imagen]" };
    case "videoMessage":
      return { message_type: "video", placeholder: "[video]" };
    case "audioMessage":
      return { message_type: "audio", placeholder: "[audio]" };
    case "documentMessage":
      return { message_type: "document", placeholder: "[documento]" };
    case "stickerMessage":
      return { message_type: "sticker", placeholder: "[sticker]" };
    case "locationMessage":
      return { message_type: "location", placeholder: "[ubicación]" };
    case "contactMessage":
    case "contactsArrayMessage":
      return { message_type: "contacts", placeholder: "[contacto]" };
    default:
      return { message_type: "text", placeholder: "" };
  }
}

export async function POST(request: NextRequest) {
  const secret = (process.env.BAILEYS_BRIDGE_SECRET || "").trim();
  if (!secret) {
    console.error(LOG, "BAILEYS_BRIDGE_SECRET no configurado en el servidor");
    return NextResponse.json({ ok: false, error: "bridge_secret_not_configured" }, { status: 500 });
  }
  const provided = (request.headers.get("x-bridge-secret") || "").trim();
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "json_invalido" }, { status: 400 });
  }

  const channelId = String(body?.channelId ?? "").trim();
  const empresaId = String(body?.empresaId ?? "").trim();
  const fromDigits = normalizeWaPhone(String(body?.fromDigits ?? ""));
  const waMessageId = String(body?.waMessageId ?? "").trim();
  const messageKind = String(body?.messageKind ?? "conversation");
  const text = typeof body?.text === "string" ? body.text : "";
  const pushName = typeof body?.pushName === "string" ? (body.pushName as string) : null;

  if (!channelId || !empresaId || !fromDigits || !waMessageId) {
    return NextResponse.json(
      { ok: false, error: "faltan campos: channelId, empresaId, fromDigits, waMessageId" },
      { status: 400 }
    );
  }

  try {
    const supabase = (await getChatServiceClientForEmpresa(empresaId)) as unknown as SupabaseAdmin;

    // Validar que el canal exista, sea de esta empresa y esté activo.
    const { data: channelRow, error: chErr } = await supabase
      .from("chat_channels")
      .select("id, empresa_id, type, provider, activo")
      .eq("id", channelId)
      .maybeSingle();
    if (chErr) throw new Error(chErr.message);
    if (!channelRow) {
      return NextResponse.json({ ok: false, error: "canal_no_encontrado" }, { status: 404 });
    }
    const ch = channelRow as {
      empresa_id?: string;
      type?: string | null;
      provider?: string | null;
      activo?: boolean | null;
    };
    if (String(ch.empresa_id ?? "") !== empresaId) {
      return NextResponse.json({ ok: false, error: "empresa_mismatch" }, { status: 400 });
    }
    if (ch.activo === false) {
      return NextResponse.json({ ok: false, error: "canal_inactivo" }, { status: 409 });
    }

    const rawType = String(ch.type ?? "whatsapp");
    const channelType: ChatChannelType = isChatChannelType(rawType) ? rawType : "whatsapp";

    const { message_type, placeholder } = mapKind(messageKind);
    const content = message_type === "text" ? text : text || placeholder;

    const result = await saveIncomingMessage({
      supabase,
      channel: { id: channelId, empresa_id: empresaId, type: channelType },
      external_id: waMessageId,
      contact_data: { address: fromDigits, display_name: pushName },
      message_data: {
        message_type,
        content: content || placeholder || "",
        raw_payload: {
          source: "baileys",
          bridge: {
            fromDigits,
            messageKind,
            hasMedia: Boolean(body?.hasMedia),
            timestamp: body?.timestamp ?? null,
          },
        },
        from_me: false,
        sender_type: "contact",
      },
      // Con Contact Center V1 activo, la asignación la hace cc_assign (abajo), no la legacy.
      skipLegacyAutoAssignment: contactCenterV1Enabled(),
    });

    if (!result.ok) {
      console.warn(LOG, "saveIncomingMessage_error", result.error);
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    if (result.skipped_duplicate) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const conversationId = result.conversation_id;

    // Ventana 24h + asignación por equidad (mismo patrón que el webhook YCloud).
    if (contactCenterV1Enabled()) {
      const schema = await fetchDataSchemaForEmpresaId(empresaId);
      const pool = getChatPostgresPool();
      if (pool && isLikelyUnexposedTenantChatSchema(schema)) {
        await applyInboundWindowAndAssignPg(pool, schema, empresaId, conversationId);
      } else {
        await applyInboundWindowAndAssignRest(supabase, schema, empresaId, conversationId);
      }
    }

    console.info(LOG, "ok", { channelId, conversationId, message_type });
    return NextResponse.json({
      ok: true,
      conversation_id: conversationId,
      message_id: result.message_id,
    });
  } catch (err) {
    console.error(LOG, "error", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
