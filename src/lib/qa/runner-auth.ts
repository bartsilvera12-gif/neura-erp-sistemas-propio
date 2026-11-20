/**
 * Helper que convierte un Request Next.js en un veredicto HMAC consumible
 * por los Route Handlers del runner. Lee el body como texto (una sola vez).
 */

import { NextResponse } from "next/server";
import {
  QA_HMAC_MAX_SKEW_SECONDS,
  verifyRequest,
  type HmacResult,
} from "./hmac";
import type { NonceStore } from "./nonce-store";

export type RunnerAuthed = {
  ok: true;
  runnerId: string;
  nonce: string;
  bodyText: string;
  bodyJson: () => unknown;
};
export type RunnerAuthError = {
  ok: false;
  response: NextResponse;
};

export async function authenticateRunner(
  request: Request,
  nonceStore: NonceStore
): Promise<RunnerAuthed | RunnerAuthError> {
  const secret = process.env.QA_RUNNER_SHARED_SECRET?.trim() || null;
  const bodyText = await request.text();
  const result: HmacResult = verifyRequest({
    headers: {
      "x-qa-timestamp": request.headers.get("x-qa-timestamp"),
      "x-qa-signature": request.headers.get("x-qa-signature"),
      "x-qa-runner-id": request.headers.get("x-qa-runner-id"),
      "x-qa-nonce": request.headers.get("x-qa-nonce"),
    },
    body: bodyText,
    secret,
  });

  if (!result.ok) {
    const status = result.code === "missing_secret" ? 500 : 401;
    return {
      ok: false,
      response: NextResponse.json(
        { error: "runner no autenticado", code: result.code },
        { status }
      ),
    };
  }

  // Dedup anti-replay: `tryConsume` devuelve false si el nonce ya se vio.
  const expiresAt = new Date(
    (result.timestamp + QA_HMAC_MAX_SKEW_SECONDS) * 1000
  );
  let consumed = false;
  try {
    consumed = await nonceStore.tryConsume({
      nonce: result.nonce,
      runnerId: result.runnerId,
      expiresAt,
    });
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "no se pudo registrar el nonce",
          code: "internal",
          detail: err instanceof Error ? err.message : "desconocido",
        },
        { status: 500 }
      ),
    };
  }
  if (!consumed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "replay detectado", code: "replay" },
        { status: 409 }
      ),
    };
  }

  let parsed: unknown = null;
  let parseAttempted = false;
  return {
    ok: true,
    runnerId: result.runnerId,
    nonce: result.nonce,
    bodyText,
    bodyJson(): unknown {
      if (!parseAttempted) {
        parseAttempted = true;
        try {
          parsed = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          parsed = null;
        }
      }
      return parsed;
    },
  };
}
