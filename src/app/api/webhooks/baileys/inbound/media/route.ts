/**
 * Archivos que ENTRAN por el canal WhatsApp QR (Baileys).
 *
 * Los mensajes con foto, video, audio o documento llegaban al inbox como un cartel
 * "[video]" y nada más: el puente avisaba que había un archivo, pero los bytes nunca
 * salían de ahí. No es un olvido tonto — la media de WhatsApp viaja cifrada con la clave
 * de la sesión, así que SOLO el puente puede descargarla. El ERP no tiene forma de ir a
 * buscarla después.
 *
 * Entonces el puente la baja y la sube acá, y esto la guarda en el mismo lugar y con el
 * mismo formato que la media de YCloud (`chat-media` + `raw_payload.erp.public_url`), que
 * es de donde el front ya sabe leer. Así las fotos y videos del canal QR se ven sin tocar
 * ni una línea del inbox.
 *
 * Seguridad: mismo `x-bridge-secret` que el webhook de mensajes.
 *
 * POST multipart: { channelId, empresaId, waMessageId, tipo, file }
 */
import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat/ycloud-media-rehost";
import type { SupabaseAdmin } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOG = "[webhooks/baileys/inbound/media]";

/** Tope de tamaño. Más que esto no entra por WhatsApp de todos modos. */
const MAX_BYTES = 64 * 1024 * 1024;

const EXT_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
};

function extensionPara(mime: string, tipo: string): string {
  const limpio = mime.split(";")[0].trim().toLowerCase();
  if (EXT_POR_MIME[limpio]) return EXT_POR_MIME[limpio];
  const porTipo: Record<string, string> = {
    image: "jpg",
    video: "mp4",
    audio: "ogg",
    sticker: "webp",
  };
  return porTipo[tipo] || "bin";
}

export async function POST(request: NextRequest) {
  const secret = (process.env.BAILEYS_BRIDGE_SECRET || "").trim();
  if (!secret) {
    console.error(LOG, "BAILEYS_BRIDGE_SECRET no configurado en el servidor");
    return NextResponse.json({ ok: false, error: "bridge_secret_not_configured" }, { status: 500 });
  }
  if ((request.headers.get("x-bridge-secret") || "").trim() !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "multipart_invalido" }, { status: 400 });
  }

  const empresaId = String(form.get("empresaId") ?? "").trim();
  const waMessageId = String(form.get("waMessageId") ?? "").trim();
  const tipo = String(form.get("tipo") ?? "document").trim();
  const file = form.get("file");

  if (!empresaId || !waMessageId || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "faltan campos: empresaId, waMessageId, file" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "archivo_muy_grande" }, { status: 413 });
  }

  try {
    const supabase = (await getChatServiceClientForEmpresa(empresaId)) as unknown as SupabaseAdmin;

    // El mensaje lo creó el webhook de texto un instante antes. Si no está, el puente
    // reintentará en el próximo mensaje: no vale la pena inventar una fila huérfana.
    const { data: fila, error: errMsg } = await supabase
      .from("chat_messages")
      .select("id, conversation_id, raw_payload")
      .eq("empresa_id", empresaId)
      .eq("wa_message_id", waMessageId)
      .maybeSingle();
    if (errMsg) throw new Error(errMsg.message);
    if (!fila) {
      return NextResponse.json({ ok: false, error: "mensaje_no_encontrado" }, { status: 404 });
    }

    const mensaje = fila as {
      id: string;
      conversation_id: string;
      raw_payload: Record<string, unknown> | null;
    };

    const mime = (file.type || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const bytes = Buffer.from(await file.arrayBuffer());
    const ruta = `${empresaId}/${mensaje.conversation_id}/in_${mensaje.id}.${extensionPara(mime, tipo)}`;

    const subida = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(ruta, bytes, { contentType: mime, upsert: true });
    if (subida.error) throw new Error("upload: " + (subida.error.message ?? "desconocido"));

    const { data: pub } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(ruta);
    const publicUrl = pub?.publicUrl;
    if (!publicUrl) throw new Error("sin_public_url");

    // Mismo formato que usa el re-hospedaje de YCloud: el front ya lee de acá.
    const raw = (mensaje.raw_payload ?? {}) as Record<string, unknown>;
    const erpPrevio =
      raw.erp && typeof raw.erp === "object" && !Array.isArray(raw.erp)
        ? (raw.erp as Record<string, unknown>)
        : {};
    const { error: errUpd } = await supabase
      .from("chat_messages")
      .update({
        raw_payload: {
          ...raw,
          erp: {
            ...erpPrevio,
            public_url: publicUrl,
            storage_path: ruta,
            mime_type: mime,
            file_name: file.name || null,
            rehosted: true,
          },
        },
      })
      .eq("empresa_id", empresaId)
      .eq("id", mensaje.id);
    if (errUpd) throw new Error(errUpd.message);

    console.info(LOG, "archivo_guardado", { waMessageId, tipo, bytes: bytes.length });
    return NextResponse.json({ ok: true, public_url: publicUrl });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error(LOG, "error", detalle);
    return NextResponse.json({ ok: false, error: detalle }, { status: 500 });
  }
}
