/**
 * NEURA QA CENTER — autenticación del runner por firma HMAC (Stripe-style).
 *
 * Motivos:
 *   - Simple: no requiere librerías ni manejo de JWKS/rotación.
 *   - Fail-closed: cualquier campo faltante o firma inválida → 401.
 *   - Con expiración efectiva: cada request incluye un timestamp y la ventana
 *     se limita a 5 min por default. Los mensajes viejos (replay) son rechazados.
 *   - Firma del BODY: el servidor confirma que el payload no fue alterado.
 *
 * Headers requeridos en cada request del runner:
 *   X-QA-Timestamp: <unix seconds>
 *   X-QA-Signature: v1=<hex HMAC-SHA256>
 *   X-QA-Runner-Id: <id configurado>
 *
 * Firma = HMAC_SHA256(secret, `${timestamp}.${sha256(body)}`)
 *
 * El secreto vive en `QA_RUNNER_SHARED_SECRET` (env del ERP y del runner).
 * El runner NUNCA recibe service_role: solo el secreto compartido de HMAC.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const QA_HMAC_VERSION = "v1";
export const QA_HMAC_MAX_SKEW_SECONDS = 300; // 5 minutos

export type HmacResult =
  | { ok: true; runnerId: string; timestamp: number; nonce: string }
  | { ok: false; code: HmacFailureCode; reason: string };

export type HmacFailureCode =
  | "missing_header"
  | "bad_timestamp"
  | "stale_timestamp"
  | "bad_signature_format"
  | "signature_mismatch"
  | "missing_secret"
  | "bad_nonce"
  | "replay";

const NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function signPayload(opts: {
  secret: string;
  timestamp: number;
  body: string;
  nonce: string;
}): string {
  const bodyHash = sha256Hex(opts.body);
  // El nonce entra al material firmado para que no pueda ser alterado tras firmar.
  const canonical = `${opts.timestamp}.${opts.nonce}.${bodyHash}`;
  const sig = createHmac("sha256", opts.secret).update(canonical).digest("hex");
  return `${QA_HMAC_VERSION}=${sig}`;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifyRequest(opts: {
  headers: {
    "x-qa-timestamp"?: string | null;
    "x-qa-signature"?: string | null;
    "x-qa-runner-id"?: string | null;
    "x-qa-nonce"?: string | null;
  };
  body: string;
  secret: string | null | undefined;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): HmacResult {
  if (!opts.secret || opts.secret.length < 32) {
    return {
      ok: false,
      code: "missing_secret",
      reason: "QA_RUNNER_SHARED_SECRET no configurado o demasiado corto",
    };
  }
  const ts = opts.headers["x-qa-timestamp"];
  const sig = opts.headers["x-qa-signature"];
  const runnerId = opts.headers["x-qa-runner-id"];
  const nonce = opts.headers["x-qa-nonce"];
  if (!ts || !sig || !runnerId || !nonce) {
    return { ok: false, code: "missing_header", reason: "headers X-QA-* faltantes" };
  }
  if (!NONCE_RE.test(nonce)) {
    return { ok: false, code: "bad_nonce", reason: "nonce no es UUID" };
  }
  const tsNum = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    return { ok: false, code: "bad_timestamp", reason: "timestamp no numérico" };
  }
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - tsNum);
  if (skew > (opts.maxSkewSeconds ?? QA_HMAC_MAX_SKEW_SECONDS)) {
    return { ok: false, code: "stale_timestamp", reason: `skew=${skew}s excede ventana` };
  }
  const prefix = `${QA_HMAC_VERSION}=`;
  if (!sig.startsWith(prefix)) {
    return { ok: false, code: "bad_signature_format", reason: "versión de firma inválida" };
  }
  const actual = sig.slice(prefix.length);
  if (!/^[0-9a-f]+$/i.test(actual)) {
    return { ok: false, code: "bad_signature_format", reason: "firma no hex" };
  }
  const expected = signPayload({
    secret: opts.secret,
    timestamp: tsNum,
    body: opts.body,
    nonce,
  }).slice(prefix.length);
  if (!constantTimeEqualHex(actual.toLowerCase(), expected.toLowerCase())) {
    return { ok: false, code: "signature_mismatch", reason: "firma no coincide" };
  }
  return { ok: true, runnerId, timestamp: tsNum, nonce };
}
