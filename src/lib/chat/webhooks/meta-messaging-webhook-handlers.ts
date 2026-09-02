import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/chat/meta-signature";
import { processMetaMessagingWebhookBody } from "@/lib/chat/webhooks/meta-messaging-webhook-service";

/**
 * Handlers compartidos del webhook de mensajería de Meta (Messenger + Instagram).
 * Ambos productos de la App de Meta pueden apuntar a estas URLs; el body trae
 * `object: "page" | "instagram"` y el servicio decide el canal.
 *
 * Env:
 *  - META_MSG_VERIFY_TOKEN  → token de verificación (GET hub.verify_token).
 *  - META_MSG_APP_SECRET    → app secret para validar X-Hub-Signature-256 (POST).
 *      Si no está seteado, no se valida firma (útil para pruebas en desarrollo).
 */

const LOG = "[webhooks/meta-msg]";

/** GET — verificación del webhook (hub.mode / hub.verify_token / hub.challenge). */
export function handleMetaMessagingWebhookGet(request: NextRequest): NextResponse {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode")?.trim().toLowerCase() ?? "";
  const token = url.searchParams.get("hub.verify_token")?.trim() ?? "";
  const challenge = url.searchParams.get("hub.challenge");
  const verifyEnv = process.env.META_MSG_VERIFY_TOKEN?.trim() ?? "";

  console.info(`${LOG}[GET verify]`, {
    mode: mode || "(vacío)",
    hasChallenge: challenge != null && challenge !== "",
    hasVerifyEnv: Boolean(verifyEnv),
    tokenMatch: Boolean(verifyEnv && token && verifyEnv === token),
  });

  if (mode !== "subscribe") return new NextResponse("Forbidden", { status: 403 });
  if (!verifyEnv) {
    console.error(`${LOG}[GET verify]`, "falta META_MSG_VERIFY_TOKEN en el servidor");
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!token || token !== verifyEnv) return new NextResponse("Forbidden", { status: 403 });
  if (challenge === null || challenge === "") return new NextResponse("Forbidden", { status: 403 });

  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
  });
}

/** POST — eventos entrantes (mensajes de Messenger / Instagram Direct). */
export async function handleMetaMessagingWebhookPost(request: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await request.text();
    const appSecret = process.env.META_MSG_APP_SECRET?.trim();
    if (appSecret) {
      const sig = request.headers.get("x-hub-signature-256");
      if (!verifyMetaSignature(rawBody, sig, appSecret)) {
        return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
      }
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
    }

    const result = await processMetaMessagingWebhookBody(body);

    if (result.errors.length > 0) {
      console.warn(`${LOG}[POST]`, "con errores/advertencias", {
        processed: result.processed,
        skipped: result.skipped,
        errors: result.errors.slice(0, 10),
      });
    } else if (result.processed > 0) {
      console.info(`${LOG}[POST]`, "ok", { processed: result.processed, skipped: result.skipped });
    }

    // Meta espera 200 rápido; devolver siempre 200 salvo error de auth/parseo evita reintentos innecesarios.
    return NextResponse.json({ ok: result.ok, processed: result.processed, skipped: result.skipped });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
