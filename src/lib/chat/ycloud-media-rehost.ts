/**
 * Re-hospedaje de media de WhatsApp/YCloud en nuestro propio almacenamiento (bucket `chat-media`).
 *
 * PROBLEMA que resuelve: los mensajes entrantes (del cliente) y los echoes de coexistencia
 * (mandados desde el celular con la app de WhatsApp) guardan en `raw_payload` un LINK de descarga
 * de YCloud (`https://api.ycloud.com/v2/whatsapp/media/download/<id>?sig=t=<exp>,s=...`). Ese link
 * es una URL FIRMADA con vencimiento: el navegador la puede cargar mientras la firma esté fresca,
 * pero CADUCA a las pocas horas → la imagen/audio queda rota para siempre. Por eso casi todas las
 * imágenes viejas del inbox se ven cortadas.
 *
 * SOLUCIÓN: descargar los bytes UNA vez (pidiendo a la API de YCloud un link fresco si hace falta)
 * y subirlos a nuestro bucket público `chat-media`, dejando la URL permanente en `raw_payload.erp.
 * public_url` — el mismo lugar que ya usan los envíos salientes del ERP. El front prioriza esa URL.
 */
import {
  fetchYCloudWhatsappMessageJson,
  firstHttpsMediaLinkFromYCloudMessageDoc,
} from "@/lib/chat/ycloud-inbound-media-enrich";
import {
  getErpAttachmentPublicUrl,
  getWhatsAppMediaUrlFromRawPayload,
} from "@/lib/chat/message-erp-display";

export const CHAT_MEDIA_BUCKET = "chat-media";

/** Extensión de archivo por MIME (para nombrar el objeto en el bucket). */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

/** Extensión de respaldo por tipo de mensaje cuando no conocemos el MIME. */
function fallbackExtForType(messageType: string): string {
  switch (messageType) {
    case "image":
    case "sticker":
      return "jpg";
    case "audio":
      return "ogg";
    case "video":
      return "mp4";
    case "document":
      return "bin";
    default:
      return "bin";
  }
}

/** MIME declarado dentro del payload de media de YCloud (`image.mimeType`, etc.), si existe. */
function mimeHintFromRaw(raw: Record<string, unknown>, messageType: string): string | null {
  const roots: unknown[] = [raw.whatsappInboundMessage, raw.whatsappMessage, raw];
  const keys = messageType === "sticker" ? ["sticker"] : [messageType, "image", "video", "audio", "document"];
  for (const root of roots) {
    if (!root || typeof root !== "object" || Array.isArray(root)) continue;
    const r = root as Record<string, unknown>;
    for (const k of keys) {
      const media = r[k];
      if (media && typeof media === "object" && !Array.isArray(media)) {
        const mt = (media as { mimeType?: string; mime_type?: string }).mimeType
          ?? (media as { mime_type?: string }).mime_type;
        if (typeof mt === "string" && mt.trim()) return mt.trim().toLowerCase();
      }
    }
  }
  return null;
}

/** Cliente mínimo de storage que necesitamos (compatible con el cliente Supabase service-role). */
interface StorageLike {
  storage: {
    listBuckets: () => Promise<{ data: { name: string }[] | null; error: unknown }>;
    createBucket: (
      name: string,
      opts: { public: boolean; fileSizeLimit?: string }
    ) => Promise<{ error: { message?: string } | null }>;
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Buffer,
        opts: { contentType: string; upsert: boolean }
      ) => Promise<{ error: { message?: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
}

let bucketEnsured = false;
async function ensureBucket(supabase: StorageLike): Promise<void> {
  if (bucketEnsured) return;
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!(buckets ?? []).some((b) => b.name === CHAT_MEDIA_BUCKET)) {
    const { error } = await supabase.storage.createBucket(CHAT_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: "25MB",
    });
    if (error && !String(error.message ?? "").toLowerCase().includes("already exists")) {
      throw new Error("No se pudo crear bucket: " + (error.message ?? "desconocido"));
    }
  }
  bucketEnsured = true;
}

async function fetchWithTimeout(url: string, apiKey: string, ms: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers: { "X-API-Key": apiKey }, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export interface RehostResult {
  ok: boolean;
  skipped?: boolean;
  public_url?: string;
  storage_path?: string;
  mime_type?: string;
  bytes?: number;
  error?: string;
}

/**
 * Descarga la media de un mensaje y la re-hospeda en `chat-media`. NO toca la base: devuelve la
 * URL pública para que el caller actualice `raw_payload.erp` (webhook o backfill lo hacen distinto).
 */
export async function rehostYCloudMessageMedia(input: {
  supabase: StorageLike;
  apiKey: string;
  waMessageId: string;
  empresaId: string;
  conversationId: string;
  messageId: string;
  messageType: string;
  storedRaw: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<RehostResult> {
  const timeoutMs = input.timeoutMs ?? 12000;

  // ¿Ya está en NUESTRO storage? Nada que hacer.
  const existing = getErpAttachmentPublicUrl(input.storedRaw);
  if (existing && /\/storage\/v1\/object\//i.test(existing)) {
    return { ok: true, skipped: true, public_url: existing };
  }

  const apiKey = input.apiKey.trim();
  if (!apiKey) return { ok: false, error: "sin_api_key" };

  // 1) Conseguir un link descargable. El link guardado suele estar vencido (backfill de viejas),
  //    así que priorizamos pedir uno fresco vía la API de recuperación de mensaje; si no hay
  //    forma, caemos al link guardado (mensajes recién llegados por webhook).
  let link: string | null = null;
  const doc = await fetchYCloudWhatsappMessageJson(apiKey, input.waMessageId);
  link = firstHttpsMediaLinkFromYCloudMessageDoc(doc);
  if (!link) link = getWhatsAppMediaUrlFromRawPayload(input.storedRaw);
  if (!link) return { ok: false, error: "sin_link_media" };

  // 2) Descargar los bytes.
  let res = await fetchWithTimeout(link, apiKey, timeoutMs);
  // Si el link guardado estaba vencido y no habíamos pedido uno fresco, reintentar con retrieve.
  if ((!res || !res.ok) && !doc) {
    const doc2 = await fetchYCloudWhatsappMessageJson(apiKey, input.waMessageId);
    const fresh = firstHttpsMediaLinkFromYCloudMessageDoc(doc2);
    if (fresh) res = await fetchWithTimeout(fresh, apiKey, timeoutMs);
  }
  if (!res || !res.ok) {
    return { ok: false, error: res ? `descarga_http_${res.status}` : "descarga_timeout" };
  }

  const ab = await res.arrayBuffer().catch(() => null);
  if (!ab) return { ok: false, error: "descarga_sin_cuerpo" };
  const buf = Buffer.from(ab);
  if (buf.length < 1) return { ok: false, error: "descarga_vacia" };

  // 3) MIME: preferimos el content-type real de la descarga; si no, el declarado en el payload.
  const ctHeader = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const mime =
    (ctHeader && ctHeader !== "application/octet-stream" ? ctHeader : "") ||
    mimeHintFromRaw(input.storedRaw, input.messageType) ||
    ctHeader ||
    "application/octet-stream";
  const ext = EXT_BY_MIME[mime] ?? fallbackExtForType(input.messageType);

  // 4) Subir a nuestro bucket. Path estable por mensaje → idempotente (upsert).
  const objectPath = `${input.empresaId}/${input.conversationId}/in_${input.messageId}.${ext}`;
  await ensureBucket(input.supabase);
  const up = await input.supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(objectPath, buf, { contentType: mime, upsert: true });
  if (up.error) return { ok: false, error: "upload: " + (up.error.message ?? "desconocido") };

  const { data: pub } = input.supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(objectPath);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) return { ok: false, error: "sin_public_url" };

  return { ok: true, public_url: publicUrl, storage_path: objectPath, mime_type: mime, bytes: buf.length };
}

/** Mezcla el resultado de re-host dentro de `raw_payload`, preservando lo demás. */
export function mergeRehostIntoRaw(
  raw: Record<string, unknown>,
  r: RehostResult
): Record<string, unknown> {
  const erpExisting =
    raw.erp && typeof raw.erp === "object" && !Array.isArray(raw.erp)
      ? (raw.erp as Record<string, unknown>)
      : {};
  return {
    ...raw,
    erp: {
      ...erpExisting,
      public_url: r.public_url,
      storage_path: r.storage_path,
      mime_type: r.mime_type,
      rehosted: true,
    },
  };
}
