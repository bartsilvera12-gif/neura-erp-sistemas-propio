/**
 * Attach de media entrante del canal Baileys (WhatsApp por QR).
 *
 * El puente Baileys descarga los bytes de WhatsApp (via `downloadMediaMessage`
 * de la lib) y los manda al webhook inbound en base64, dentro del campo
 * `media: { base64, mime, filename? }`. Acá tomamos esos bytes, los subimos
 * al bucket `chat-media` y escribimos la URL pública en `raw_payload.erp` con
 * el mismo shape que ya usa Meta/YCloud, para que el front los renderice sin
 * ningún cambio.
 *
 * Si el bridge no manda `media` (por ejemplo porque todavía no se actualizó),
 * esta función es NO-OP: el mensaje se guarda con placeholder "[imagen]" /
 * "[video]" / etc. igual que antes. Es siempre best-effort — un fallo del
 * attach NO rompe la ingesta del mensaje.
 */
import type { SupabaseAdmin } from "@/lib/chat/types";

const CHAT_MEDIA_BUCKET = "chat-media";

let bucketEnsured = false;

async function ensureChatMediaBucket(supabase: SupabaseAdmin): Promise<void> {
  if (bucketEnsured) return;
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(listErr.message);
  const exists = (buckets ?? []).some((b) => b.name === CHAT_MEDIA_BUCKET);
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(CHAT_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: "25MB",
    });
    if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
      throw new Error(createErr.message);
    }
  }
  bucketEnsured = true;
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("aac") || m.includes("m4a")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  return "bin";
}

/** Tipos crudos de Baileys → `source_type` que el front espera (igual que Meta/YCloud). */
function sourceTypeFromKind(kind: string): "image" | "document" | "sticker" | "video" | "audio" | null {
  switch (kind) {
    case "imageMessage":
      return "image";
    case "videoMessage":
      return "video";
    case "audioMessage":
      return "audio";
    case "stickerMessage":
      return "sticker";
    case "documentMessage":
    case "documentWithCaptionMessage":
      return "document";
    default:
      return null;
  }
}

export type BaileysInboundMediaInput = {
  base64?: string | null;
  mime?: string | null;
  filename?: string | null;
};

export async function attachBaileysInboundMedia(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  conversationId: string;
  messageId: string;
  messageKind: string;
  media: BaileysInboundMediaInput | null | undefined;
}): Promise<void> {
  const media = params.media;
  if (!media || typeof media.base64 !== "string" || media.base64.length < 10) return;

  const sourceType = sourceTypeFromKind(params.messageKind);
  if (!sourceType) return;

  const mime = (media.mime || "").trim() || "application/octet-stream";

  // base64 → Buffer. Cuidamos un data URL por si acaso.
  const rawB64 = media.base64.includes(",") ? media.base64.slice(media.base64.indexOf(",") + 1) : media.base64;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(rawB64, "base64");
  } catch {
    console.warn("[baileys-inbound-media-attach] base64 invalido");
    return;
  }
  if (bytes.length < 1) return;

  try {
    await ensureChatMediaBucket(params.supabase);
  } catch (e) {
    console.warn("[baileys-inbound-media-attach] ensure bucket falló", e instanceof Error ? e.message : e);
    return;
  }

  const ext = extensionFromMime(mime);
  const path = `${params.empresaId}/${params.conversationId}/${params.messageId}.${ext}`;

  const { error: upErr } = await params.supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (upErr) {
    console.warn("[baileys-inbound-media-attach] upload falló", upErr.message);
    return;
  }

  const { data: pub } = params.supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) return;

  // Mergeamos `erp` sobre el raw_payload ya persistido por saveIncomingMessage —
  // sin pisar los metadata del bridge (source, bridge: {...}) ni nada más.
  const { data: row } = await params.supabase
    .from("chat_messages")
    .select("raw_payload")
    .eq("id", params.messageId)
    .maybeSingle();

  const prev =
    row?.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
      ? (row.raw_payload as Record<string, unknown>)
      : {};

  const erp = {
    public_url: publicUrl,
    storage_path: path,
    mime_type: mime,
    filename: media.filename ?? null,
    source_type: sourceType,
  };

  const { error: updErr } = await params.supabase
    .from("chat_messages")
    .update({ raw_payload: { ...prev, erp } as unknown as Record<string, unknown> })
    .eq("id", params.messageId);
  if (updErr) {
    console.warn("[baileys-inbound-media-attach] update raw_payload falló", updErr.message);
  }
}
