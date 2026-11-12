/**
 * Helper que convierte un Request Next.js en un veredicto HMAC consumible
 * por los Route Handlers del runner. Lee el body como texto (una sola vez).
 */

import { NextResponse } from "next/server";
import { verifyRequest, type HmacResult } from "./hmac";

export type RunnerAuthed = {
  ok: true;
  runnerId: string;
  bodyText: string;
  bodyJson: () => unknown;
};
export type RunnerAuthError = {
  ok: false;
  response: NextResponse;
};

export async function authenticateRunner(
  request: Request
): Promise<RunnerAuthed | RunnerAuthError> {
  const secret = process.env.QA_RUNNER_SHARED_SECRET?.trim() || null;
  const bodyText = await request.text();
  const result: HmacResult = verifyRequest({
    headers: {
      "x-qa-timestamp": request.headers.get("x-qa-timestamp"),
      "x-qa-signature": request.headers.get("x-qa-signature"),
      "x-qa-runner-id": request.headers.get("x-qa-runner-id"),
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

  let parsed: unknown = null;
  let parseAttempted = false;
  return {
    ok: true,
    runnerId: result.runnerId,
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
