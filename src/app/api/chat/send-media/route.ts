import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { pgLoadConversationForSend } from "@/lib/chat/chat-send-persist-pg";
import { markFirstHumanOperatorReply } from "@/lib/chat/conversation-sla-markers";
import { getAuthWithRol } from "@/lib/middleware/auth";
import {
  resolveOutboundTextContextFromIds,
  type ChannelOutboundTextContext,
} from "@/lib/chat/outbound-send-dispatch";
import {
  sendWhatsAppAudio,
  sendWhatsAppDocument,
  sendWhatsAppImage,
  sendWhatsAppVideo,
  type SendWhatsAppTextResult,
} from "@/lib/chat/whatsapp-send-service";
import {
  sendYCloudWhatsappMediaViaLink,
  sendYCloudWhatsappAudioById,
  uploadYCloudWhatsappMedia,
} from "@/lib/chat/ycloud-send-service";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
// Comprimir video puede tardar; damos margen (algunos hosts respetan este límite).
export const maxDuration = 120;

const CHAT_MEDIA_BUCKET = "chat-media";
const execFileAsync = promisify(execFile);

/** Límite duro de la API de WhatsApp para video. Meta rechaza cualquier video más grande. */
const VIDEO_LIMIT_BYTES = 16 * 1024 * 1024;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "archivo";
}

/**
 * Convierte el audio grabado (webm/opus) -> MP3 (audio/mpeg) para enviarlo como AUDIO NORMAL
 * (no nota de voz).
 *
 * Por qué MP3 y no ogg/opus con voice:true: las NOTAS DE VOZ enviadas por la API de WhatsApp
 * (`voice: true`) son inestables del lado del receptor — aunque se entreguen (status delivered/
 * read), a muchos clientes les muestra "Este audio ya no está disponible" al reproducir. El MP3
 * como audio normal se descarga al teléfono del cliente y queda reproducible de forma confiable
 * (pierde la onda de "nota de voz", pero SIEMPRE se escucha). Mono 64k es más que suficiente para voz.
 *
 * Usa execFile con args array (sin shell) y archivos temporales con nombres propios. Lanza si
 * ffmpeg no está disponible o no produce salida → el caller NO envía el webm crudo.
 */
async function transcodeAudioToMp3(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "ccaudio-"));
  const inPath = join(dir, "in.webm");
  const outPath = join(dir, "out.mp3");
  try {
    await writeFile(inPath, input);
    await execFileAsync(
      "ffmpeg",
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", inPath,
        "-vn",
        "-c:a", "libmp3lame", "-b:a", "64k", "-ar", "44100", "-ac", "1",
        "-f", "mp3", outPath,
      ],
      { timeout: 60000 }
    );
    const out = await readFile(outPath);
    if (!out || out.length < 1) throw new Error("ffmpeg produjo un MP3 vacío");
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Duración del video en segundos (ffprobe). 0 si no se puede determinar. */
async function probeDurationSeconds(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
      { timeout: 20000 }
    );
    const d = parseFloat(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0; // ffprobe no disponible → caemos al step-down por CRF
  }
}

/**
 * Comprime un video para que entre en el límite de 16 MB de WhatsApp. La API de WhatsApp (vía
 * YCloud) NO comprime — rechaza cualquier video > 16 MB. (La app del celular sí comprime sola,
 * por eso ahí "nunca" se ve el límite.) Escalamos a máx 720p (nítido en pantalla de celular) y
 * elegimos el bitrate según la duración para apuntar a ~15 MB. Solo se llama si el video excede.
 * Si aún no entra, reintenta a 480p con bitrate más bajo; si tampoco, lanza VIDEO_TOO_LONG.
 */
async function compressVideoUnder16MB(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "ccvideo-"));
  const inPath = join(dir, "in.video");
  const outPath = join(dir, "out.mp4");
  try {
    await writeFile(inPath, input);
    const duration = await probeDurationSeconds(inPath);
    const AUDIO_K = 128;
    const TARGET_BYTES = 15 * 1024 * 1024; // margen bajo el límite de 16

    async function encode(maxHeight: number, videoK: number | null): Promise<Buffer> {
      const args = [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", inPath,
        "-vf", `scale=-2:'min(${maxHeight},ih)'`,
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      ];
      if (videoK) {
        args.push("-b:v", `${videoK}k`, "-maxrate", `${Math.round(videoK * 1.45)}k`, "-bufsize", `${videoK * 2}k`);
      } else {
        args.push("-crf", "30", "-maxrate", "1600k", "-bufsize", "3200k");
      }
      args.push("-c:a", "aac", "-b:a", `${AUDIO_K}k`, "-ac", "2", "-movflags", "+faststart", outPath);
      await execFileAsync("ffmpeg", args, { timeout: 110000, maxBuffer: 1024 * 1024 * 64 });
      return readFile(outPath);
    }

    let videoK: number | null = null;
    if (duration > 0) {
      const totalK = (TARGET_BYTES * 8) / 1000 / duration; // kbps totales que entran en el target
      videoK = Math.max(350, Math.min(Math.round(totalK - AUDIO_K), 4000));
    }

    let out = await encode(720, videoK);
    if (out.length > VIDEO_LIMIT_BYTES) {
      const k2 = duration > 0 ? Math.max(300, Math.round((videoK ?? 1200) * 0.65)) : 800;
      out = await encode(480, k2);
    }
    if (out.length > VIDEO_LIMIT_BYTES) throw new Error("VIDEO_TOO_LONG");
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * POST multipart: conversation_id, file (opcional caption)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const form = await request.formData().catch(() => null);
    const convRaw = form?.get("conversation_id");
    const conversationId = typeof convRaw === "string" ? convRaw.trim() : "";
    const capRaw = form?.get("caption");
    const caption = typeof capRaw === "string" ? capRaw.trim().slice(0, 1024) : "";
    const file = form?.get("file");

    if (!conversationId || !(file instanceof File) || file.size < 1) {
      return NextResponse.json(
        { ok: false, error: "Se requiere conversation_id y archivo" },
        { status: 400 }
      );
    }

    const maxBytes = 15 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json({ ok: false, error: "Archivo demasiado grande (máx. 15 MB)" }, { status: 400 });
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const dataSchema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const pool = getChatPostgresPool();
    const tenantPg = Boolean(pool && isLikelyUnexposedTenantChatSchema(dataSchema));

    let conv: { empresa_id: string; contact_id: string; channel_id: string } | null = null;

    if (tenantPg && pool) {
      conv = await pgLoadConversationForSend(pool, dataSchema, conversationId);
    } else {
      const { data: cdata, error: cErr } = await supabase
        .from("chat_conversations")
        .select("id, empresa_id, contact_id, channel_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (cErr || !cdata) {
        return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
      }
      conv = {
        empresa_id: cdata.empresa_id as string,
        contact_id: cdata.contact_id as string,
        channel_id: cdata.channel_id as string,
      };
    }

    if (!conv) {
      return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    }

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
      else if (msg.includes("configuración completa")) status = 400;
      else if (msg.includes("token") || msg.includes("ycloud_api_key")) status = 500;
      return NextResponse.json({ ok: false, error: msg }, { status });
    }

    const toDigits = outboundCtx.toDigits;
    const provider = outboundCtx.provider;
    const ycloudApiKey = provider === "ycloud" ? outboundCtx.apiKey : "";
    const ycloudFromE164 = provider === "ycloud" ? outboundCtx.fromE164 : null;
    const phoneNumberId = provider === "meta" ? outboundCtx.phoneNumberId : null;
    const token = provider === "meta" ? outboundCtx.accessToken : null;

    if (!toDigits) {
      return NextResponse.json({ ok: false, error: "Falta teléfono del contacto" }, { status: 400 });
    }

    const { data: buckets } = await supabase.storage.listBuckets();
    if (!(buckets ?? []).some((b) => b.name === CHAT_MEDIA_BUCKET)) {
      const { error: bcErr } = await supabase.storage.createBucket(CHAT_MEDIA_BUCKET, {
        public: true,
        fileSizeLimit: "15MB",
      });
      if (bcErr && !bcErr.message.toLowerCase().includes("already exists")) {
        return NextResponse.json({ ok: false, error: bcErr.message }, { status: 500 });
      }
    }

    const originalMime = (file.type || "").toLowerCase();
    let buf: Buffer = Buffer.from(await file.arrayBuffer());
    let origName = safeFileName(file.name || "archivo");
    let uploadMime = file.type || "application/octet-stream";

    // El audio grabado (webm/opus del MediaRecorder, desktop y APK) se transcodea a MP3 y se
    // envía como AUDIO NORMAL (no nota de voz). Las notas de voz por API (voice:true) llegan pero
    // son inestables para reproducir en el cliente ("audio ya no está disponible"), incluso
    // entregadas. El MP3 como audio normal se descarga al teléfono y se reproduce confiablemente.
    // Cualquier audio GRABADO desde el navegador (webm/opus en Android/Chrome, mp4/aac en iOS)
    // se transcodea a MP3. ffmpeg auto-detecta el contenedor de entrada por su contenido, así que
    // no importa la extensión con la que venga nombrado. (Antes solo cubría webm → iOS no podía
    // enviar notas de voz: llegaba como mp4 y no se transcodeaba/enrutaba bien.)
    const isRecordedAudio =
      originalMime.startsWith("audio/") &&
      (originalMime.includes("webm") ||
        originalMime.includes("ogg") ||
        originalMime.includes("mp4") ||
        originalMime.includes("m4a") ||
        originalMime.includes("aac") ||
        /\.(webm|ogg|mp4|m4a|aac)$/i.test(file.name || ""));
    if (isRecordedAudio) {
      try {
        buf = await transcodeAudioToMp3(buf);
      } catch (e) {
        // El detalle técnico (comando ffmpeg / EBML) queda en logs; al asesor le mostramos algo claro.
        console.warn("[send-media] transcode audio fallo", {
          conversationId,
          mime: originalMime,
          name: file.name,
          detail: e instanceof Error ? e.message : String(e),
        });
        return NextResponse.json(
          {
            ok: false,
            error: "No se pudo procesar la nota de voz. Volvé a grabarla (mantené presionado el micrófono hasta terminar).",
          },
          { status: 500 }
        );
      }
      origName = (origName.replace(/\.(webm|ogg|mp4|m4a|aac)$/i, "") || "audio") + ".mp3";
      uploadMime = "audio/mpeg";
    }

    // Video que supera el límite de WhatsApp → lo comprimimos (máx 720p, ~15 MB). Si no,
    // Meta lo rechaza (la API no comprime sola como la app del celular).
    if (originalMime.startsWith("video/") && buf.length > VIDEO_LIMIT_BYTES) {
      try {
        buf = await compressVideoUnder16MB(buf);
        origName = (origName.replace(/\.[^.]+$/, "") || "video") + ".mp4";
        uploadMime = "video/mp4";
      } catch (e) {
        const tooLong = e instanceof Error && e.message === "VIDEO_TOO_LONG";
        console.warn("[send-media] compress video falló", {
          conversationId,
          name: file.name,
          detail: e instanceof Error ? e.message : String(e),
        });
        return NextResponse.json(
          {
            ok: false,
            error: tooLong
              ? "El video es muy largo para comprimirlo bajo 16 MB. Recortalo o compartí un enlace."
              : "No se pudo comprimir el video. Probá con uno más corto o compartí un enlace.",
          },
          { status: 400 }
        );
      }
    }

    const objectPath = `${empresaId}/${conversationId}/out_${Date.now()}_${origName}`;

    const { error: upErr } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(objectPath, buf, {
        contentType: uploadMime,
        upsert: true,
      });

    if (upErr) {
      return NextResponse.json({ ok: false, error: "No se pudo subir el archivo: " + upErr.message }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(objectPath);
    const publicUrl = pub?.publicUrl;
    if (!publicUrl) {
      return NextResponse.json({ ok: false, error: "No se pudo obtener URL pública del archivo" }, { status: 500 });
    }

    // mime EFECTIVO (tras posible remux) para rutear el tipo a WhatsApp/YCloud.
    const mime = uploadMime.toLowerCase();
    const isImage = mime.startsWith("image/");
    const isAudio = mime.startsWith("audio/");
    const isVideo = mime.startsWith("video/");

    let sendResult: SendWhatsAppTextResult;
    let outboundMessageType: "image" | "document" | "audio" | "video";

    if (provider === "ycloud") {
      if (isImage) {
        outboundMessageType = "image";
        sendResult = await sendYCloudWhatsappMediaViaLink({
          apiKey: ycloudApiKey,
          fromE164: ycloudFromE164!,
          toDigits,
          kind: "image",
          mediaLink: publicUrl,
          caption: caption || undefined,
        });
      } else if (isAudio) {
        outboundMessageType = "audio";
        // AUDIO NORMAL (no nota de voz): subimos el MP3 a YCloud y enviamos por MEDIA ID SIN
        // voice:true. Las notas de voz por API son inestables para reproducir en el cliente
        // ("audio ya no está disponible") aunque se entreguen; el audio normal (mp3) se descarga
        // y se reproduce siempre. Si la subida falla, degradamos al link.
        const uploaded = await uploadYCloudWhatsappMedia({
          apiKey: ycloudApiKey,
          fromE164: ycloudFromE164!,
          bytes: buf,
          filename: origName,
          contentType: uploadMime,
        });
        if (uploaded.ok) {
          sendResult = await sendYCloudWhatsappAudioById({
            apiKey: ycloudApiKey,
            fromE164: ycloudFromE164!,
            toDigits,
            mediaId: uploaded.mediaId,
            voice: false,
          });
        } else {
          console.warn("[api/chat/send-media] upload YCloud audio falló, fallback a link:", uploaded.error);
          sendResult = await sendYCloudWhatsappMediaViaLink({
            apiKey: ycloudApiKey,
            fromE164: ycloudFromE164!,
            toDigits,
            kind: "audio",
            mediaLink: publicUrl,
          });
        }
      } else if (isVideo) {
        outboundMessageType = "video";
        sendResult = await sendYCloudWhatsappMediaViaLink({
          apiKey: ycloudApiKey,
          fromE164: ycloudFromE164!,
          toDigits,
          kind: "video",
          mediaLink: publicUrl,
          caption: caption || undefined,
        });
      } else {
        outboundMessageType = "document";
        sendResult = await sendYCloudWhatsappMediaViaLink({
          apiKey: ycloudApiKey,
          fromE164: ycloudFromE164!,
          toDigits,
          kind: "document",
          mediaLink: publicUrl,
          filename: origName,
          caption: caption || undefined,
        });
      }
    } else if (isImage) {
      outboundMessageType = "image";
      sendResult = await sendWhatsAppImage({
        toDigits,
        phoneNumberId: phoneNumberId!,
        accessToken: token!,
        imageUrl: publicUrl,
        caption: caption || undefined,
      });
    } else if (isAudio) {
      outboundMessageType = "audio";
      sendResult = await sendWhatsAppAudio({
        toDigits,
        phoneNumberId: phoneNumberId!,
        accessToken: token!,
        audioUrl: publicUrl,
      });
    } else if (isVideo) {
      outboundMessageType = "video";
      sendResult = await sendWhatsAppVideo({
        toDigits,
        phoneNumberId: phoneNumberId!,
        accessToken: token!,
        videoUrl: publicUrl,
        caption: caption || undefined,
      });
    } else {
      outboundMessageType = "document";
      sendResult = await sendWhatsAppDocument({
        toDigits,
        phoneNumberId: phoneNumberId!,
        accessToken: token!,
        link: publicUrl,
        filename: origName,
        caption: caption || undefined,
      });
    }

    if (!sendResult.ok) {
      return NextResponse.json(
        { ok: false, error: sendResult.error, meta: sendResult.raw },
        { status: 502 }
      );
    }

    const ts = new Date().toISOString();
    const contentLabel =
      outboundMessageType === "image"
        ? caption
          ? `Imagen: ${caption}\n${publicUrl}`
          : `Imagen enviada\n${publicUrl}`
        : outboundMessageType === "audio"
          ? caption
            ? `Audio: ${caption}\n${publicUrl}`
            : `Audio enviado\n${publicUrl}`
          : outboundMessageType === "video"
            ? caption
              ? `Video: ${caption}\n${publicUrl}`
              : `Video enviado\n${publicUrl}`
            : caption
              ? `Documento: ${origName}\n${caption}\n${publicUrl}`
              : `Documento: ${origName}\n${publicUrl}`;

    const { error: insErr } = await supabase.from("chat_messages").insert({
      empresa_id: empresaId,
      conversation_id: conversationId,
      wa_message_id: sendResult.waMessageId,
      from_me: true,
      sender_type: "human",
      sent_by_user_id: auth.user.id,
      sent_by_user_name: auth.nombre ?? auth.user.email ?? null,
      message_type: outboundMessageType,
      content: contentLabel,
      raw_payload: {
        ...(sendResult.raw && typeof sendResult.raw === "object" ? sendResult.raw : {}),
        erp: {
          public_url: publicUrl,
          storage_path: objectPath,
          mime_type: uploadMime,
          original_mime: originalMime || null,
          filename: origName,
          caption: caption || null,
        },
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
      .update({
        last_message_at: ts,
        last_message_preview: contentLabel.slice(0, 280),
        updated_at: ts,
      })
      .eq("id", conversationId);

    await markFirstHumanOperatorReply(supabase, empresaId, conversationId, {
      from_me: true,
      sender_type: "human",
    });

    return NextResponse.json({ ok: true, wa_message_id: sendResult.waMessageId, public_url: publicUrl });
  } catch (e) {
    console.error("[api/chat/send-media]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
