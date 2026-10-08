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
 *   {
 *     channelId, empresaId, fromDigits, fromPhone?, waMessageId, messageKind,
 *     text?, pushName?, hasMedia?, timestamp?,
 *     // Media (opcional). Cuando el bridge descarga los bytes via
 *     // downloadMediaMessage(), los adjunta como base64 acá. El ERP los sube
 *     // a Supabase Storage y los deja renderizables en el inbox igual que
 *     // Meta/YCloud (raw_payload.erp.{public_url, storage_path, ...}).
 *     media?: { base64: string, mime: string, filename?: string | null }
 *   }
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
import {
  attachBaileysInboundMedia,
  type BaileysInboundMediaInput,
} from "@/lib/chat/baileys-inbound-media-attach";

export const dynamic = "force-dynamic";

const LOG = "[webhooks/baileys/inbound]";

type MappedKind =
  | { skip: true; reason: string }
  | { skip?: false; message_type: string; placeholder: string };

/**
 * Mapea el tipo de mensaje de Baileys al `message_type` del ERP + un preview.
 *
 * Antes el `default` guardaba todo como `text` con contenido vacío, y en el inbox
 * aparecían burbujas grises sin texto cada vez que el cliente reaccionaba con un
 * emoji, editaba un mensaje o eliminaba uno (y también para eventos de protocolo
 * internos que WhatsApp manda y no son conversación). Ahora:
 *  - Los tipos útiles con texto/media siguen mapeando igual.
 *  - Las reacciones/ediciones/revokes se marcan con su `message_type` propio;
 *    si el bridge adjunta un placeholder, se muestra algo visible (si no, el
 *    front los filtra por `message_type !== 'reaction'` para no estorbar).
 *  - Los tipos de protocolo o desconocidos se SALTEAN (no se crea fila). El
 *    webhook responde 200 OK y punto; sin esto el inbox se ensucia.
 */
function mapKind(kind: string): MappedKind {
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
    case "documentWithCaptionMessage":
      return { message_type: "document", placeholder: "[documento]" };
    case "stickerMessage":
      return { message_type: "sticker", placeholder: "[sticker]" };
    case "locationMessage":
    case "liveLocationMessage":
      return { message_type: "location", placeholder: "[ubicación]" };
    case "contactMessage":
    case "contactsArrayMessage":
      return { message_type: "contacts", placeholder: "[contacto]" };
    case "reactionMessage":
      return { message_type: "reaction", placeholder: "" };
    case "editedMessage":
    case "messageEditMessage":
      return { message_type: "edit", placeholder: "[mensaje editado]" };
    // protocolMessage incluye revokes, syncs, keys, acks de protocolo: nada
    // de esto es conversación. Antes caían al default y aparecían como
    // burbujas vacías. Se saltean a propósito.
    case "protocolMessage":
    case "senderKeyDistributionMessage":
    case "messageContextInfo":
    case "ephemeralMessage":
    case "pollUpdateMessage":
      return { skip: true, reason: kind };
    default:
      // Cualquier tipo nuevo que no reconocemos NO lo guardamos como texto
      // vacío. Si en el futuro aparece algo útil (polls, buttons), se agrega
      // acá explícitamente. Mientras tanto queda el log y la fila no se crea.
      return { skip: true, reason: `desconocido:${kind}` };
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
  // Teléfono real cuando el chat llega con un @lid (identificador interno de WhatsApp).
  const fromPhone = normalizeWaPhone(String(body?.fromPhone ?? ""));
  const waMessageId = String(body?.waMessageId ?? "").trim();
  const messageKind = String(body?.messageKind ?? "conversation");
  const text = typeof body?.text === "string" ? body.text : "";
  const pushName = typeof body?.pushName === "string" ? (body.pushName as string) : null;
  // true = saliente espejado del celu (la PM respondió desde la app); false = entrante del cliente.
  const fromMe = body?.fromMe === true;

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

    const mapped = mapKind(messageKind);
    if (mapped.skip) {
      // Tipo irrelevante para el inbox (protocolo, update de poll, etc). Ack OK
      // sin crear fila; el bridge no reintenta y el inbox queda limpio.
      console.info(LOG, "skip_kind", { kind: messageKind, reason: mapped.reason });
      return NextResponse.json({ ok: true, skipped: true, reason: mapped.reason });
    }
    const { message_type, placeholder } = mapped;
    const content = message_type === "text" ? text : text || placeholder;

    const result = await saveIncomingMessage({
      supabase,
      channel: { id: channelId, empresa_id: empresaId, type: channelType },
      external_id: waMessageId,
      // En los salientes espejados (fromMe) el pushName es el del negocio, no el del contacto:
      // no pisamos el nombre del contacto con eso.
      contact_data: { address: fromDigits, display_name: fromMe ? null : pushName },
      message_data: {
        message_type,
        content: content || placeholder || "",
        raw_payload: {
          source: "baileys",
          bridge: {
            fromDigits,
            messageKind,
            hasMedia: Boolean(body?.hasMedia),
            fromMe,
            timestamp: body?.timestamp ?? null,
          },
        },
        from_me: fromMe,
        sender_type: fromMe ? "human" : "contact",
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

    // El número que se ve en el inbox queda corregido acá. Los chats que entran con @lid
    // guardaban el identificador interno como si fuera el teléfono (`219537454674033`), y así
    // quedaba a la vista para siempre. Se corrige la MISMA fila: no se crea un contacto nuevo,
    // no se parte el historial.
    await corregirTelefonoDelContacto(supabase, empresaId, result.contact_id, fromDigits, fromPhone);

    // Media del cliente (foto/video/audio/doc/sticker): si el bridge adjuntó
    // los bytes en base64, los subimos a Storage y los dejamos renderizables
    // en el inbox. Best-effort: si falla, el mensaje queda con placeholder
    // ("[imagen]" / "[video]" / ...) pero NO rompemos la ingesta.
    const mediaRaw = body?.media as Record<string, unknown> | null | undefined;
    const media: BaileysInboundMediaInput | null =
      mediaRaw && typeof mediaRaw === "object" && typeof mediaRaw.base64 === "string"
        ? {
            base64: String(mediaRaw.base64),
            mime: typeof mediaRaw.mime === "string" ? mediaRaw.mime : null,
            filename: typeof mediaRaw.filename === "string" ? mediaRaw.filename : null,
          }
        : null;
    if (media && result.message_id) {
      try {
        await attachBaileysInboundMedia({
          supabase,
          empresaId,
          conversationId,
          messageId: result.message_id,
          messageKind,
          media,
        });
      } catch (e) {
        console.warn(LOG, "attach_media_error", e instanceof Error ? e.message : e);
      }
    }

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

/**
 * Reemplaza el identificador interno (@lid) por el teléfono real del contacto.
 *
 * Solo actúa cuando WhatsApp mandó el teléfono y es distinto al guardado. Si YA existe otro
 * contacto de la empresa con ese teléfono, no se toca nada: fusionar dos contactos es otra
 * decisión y hacerlo acá, a ciegas, rompería el índice único (empresa_id, phone_number).
 */
async function corregirTelefonoDelContacto(
  supabase: SupabaseAdmin,
  empresaId: string,
  contactId: string,
  guardado: string,
  telefonoReal: string
): Promise<void> {
  if (!contactId || !telefonoReal || telefonoReal === guardado) return;
  try {
    const { data: ocupado } = await supabase
      .from("chat_contacts")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("phone_number", telefonoReal)
      .maybeSingle();
    if (ocupado && String((ocupado as { id?: string }).id ?? "") !== contactId) {
      console.info(LOG, "telefono_real_ya_usado", { contactId, telefonoReal });
      return;
    }

    const parche: Record<string, unknown> = {
      phone_number: telefonoReal,
      phone_normalized: telefonoReal,
      updated_at: new Date().toISOString(),
    };
    const { data: actual } = await supabase
      .from("chat_contacts")
      .select("name")
      .eq("id", contactId)
      .maybeSingle();
    // Si el nombre visible era el código interno, también queda corregido.
    const nombre = String((actual as { name?: string | null } | null)?.name ?? "");
    if (nombre && nombre.replace(/\D+/g, "") === guardado) parche.name = telefonoReal;

    const { error } = await supabase
      .from("chat_contacts")
      .update(parche)
      .eq("empresa_id", empresaId)
      .eq("id", contactId);
    if (error) console.warn(LOG, "no_se_pudo_corregir_telefono", error.message);
    else console.info(LOG, "telefono_corregido", { contactId, de: guardado, a: telefonoReal });
  } catch (e) {
    // Corregir el número es cosmético: si falla, el mensaje ya se guardó igual.
    console.warn(LOG, "corregir_telefono_fallo", e instanceof Error ? e.message : String(e));
  }
}
