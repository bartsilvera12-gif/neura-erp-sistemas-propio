import { NextRequest } from "next/server";
import {
  handleMetaMessagingWebhookGet,
  handleMetaMessagingWebhookPost,
} from "@/lib/chat/webhooks/meta-messaging-webhook-handlers";

/**
 * Webhook de Facebook Messenger (Meta Messenger Platform).
 * GET: verificación (hub.challenge). POST: mensajes entrantes del Direct de la página.
 *
 * Ruta estática: gana sobre `api/webhooks/[channel]` para la misma URL.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleMetaMessagingWebhookGet(request);
}

export async function POST(request: NextRequest) {
  return handleMetaMessagingWebhookPost(request);
}
