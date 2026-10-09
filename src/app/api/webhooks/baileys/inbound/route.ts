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
 *   { channelId, empresaId, fromDigits, fromPhone?, waMessageId, messageKind,
 *     text?, pushName?, hasMedia?, timestamp? }
 *
 * Para media (foto/video/audio/doc/sticker): el bridge llama a /inbound con
 * este JSON (el mensaje queda con placeholder "[imagen]" / "[video]" / ...),
 * y después sube el archivo por multipart a /inbound/media con el mismo
 * waMessageId. Ese segundo endpoint es el que attachéa la URL del archivo
 * a la fila ya persistida acá.
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
  // JID original de WhatsApp con su sufijo real (`<id>@lid` o `<pn>@s.whatsapp.net`).
  // El puente ya lo manda; lo preservamos para enviar al destino correcto (ver abajo).
  const fromJid = typeof body?.fromJid === "string" ? (body.fromJid as string).trim() : "";
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

    // El contacto se guarda SIEMPRE con el identificador con el que llega el mensaje.
    //
    // Se probó guardarlo con el teléfono real cuando WhatsApp lo mandaba, para que el inbox no
    // mostrara el código interno. Resultado: se duplicaron los chats. El contacto viejo seguía
    // existiendo bajo el código y el mensaje nuevo creaba otro bajo el teléfono, así que el
    // mismo cliente aparecía dos veces, en dos colas y con dos agentes.
    //
    // Mostrar el código feo es mucho menos grave que duplicar conversaciones. Para arreglar lo
    // que se ve sin partir nada hay que guardar el @lid EN el contacto y buscar por los dos.
    const direccionContacto = fromDigits;

    const result = await saveIncomingMessage({
      supabase,
      channel: { id: channelId, empresa_id: empresaId, type: channelType },
      external_id: waMessageId,
      // En los salientes espejados (fromMe) el pushName es el del negocio, no el del contacto:
      // no pisamos el nombre del contacto con eso.
      contact_data: { address: direccionContacto, display_name: fromMe ? null : pushName },
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

    // Preservar el JID original (@lid / @s.whatsapp.net) en la fila del contacto que coincide
    // con el identificador entrante (por phone_number), para enviar después al destino correcto.
    // NO se renombra phone_number (eso partía el chat): solo se guarda el JID aparte.
    // Drift-safe: solo corre en el canal baileys (neura); si la columna no existiera, se traga.
    if (fromJid.includes("@")) {
      try {
        await supabase
          .from("chat_contacts")
          .update({ wa_jid: fromJid })
          .eq("empresa_id", empresaId)
          .eq("phone_number", direccionContacto);
      } catch (e) {
        console.warn(LOG, "wa_jid_update_fallo", e instanceof Error ? e.message : String(e));
      }
    }

    // Nota: los bytes de la media (foto/video/audio/doc/sticker) los sube el
    // bridge como multipart al endpoint /inbound/media, usando el mismo
    // waMessageId. Ese otro route es el que adjunta la URL del archivo a la
    // fila que acabamos de persistir acá. No bloqueamos este ack esperando
    // la descarga de bytes.

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

    console.info(LOG, "ok", {
      channelId,
      conversationId,
      message_type,
      jid_tipo: fromJid.endsWith("@lid") ? "lid" : fromJid.endsWith("@s.whatsapp.net") ? "pn" : fromJid ? "otro" : "sin_jid",
    });
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
