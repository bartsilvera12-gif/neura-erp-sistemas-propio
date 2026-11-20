/**
 * NEURA QA CENTER — guards comunes para rutas /api/qa/*.
 *
 *   · `requireJsonContentType(req)` — rechaza si el request no es JSON (CSRF defense).
 *   · `rateLimit(key, opts)` — in-memory sliding-window rate limit.
 *     Por ser in-memory, es por-proceso. Suficiente contra abuso desde panel;
 *     no sirve como DoS prevention global (para eso hay que montar algo en
 *     el reverse proxy). Reset al reiniciar la app. Se puede swappear por
 *     Redis en el futuro sin cambiar la API.
 */

import { NextResponse } from "next/server";

export function requireJsonContentType(request: Request): NextResponse | null {
  const ct = (request.headers.get("content-type") ?? "").toLowerCase();
  // Aceptamos application/json; charset=utf-8 también.
  if (!ct.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type debe ser application/json", code: "bad_content_type" },
      { status: 415 }
    );
  }
  return null;
}

type Bucket = {
  // Timestamps (ms) de los hits dentro de la ventana activa.
  hits: number[];
};

type GlobalBucketStore = { [k: string]: Bucket };

const GLOBAL_KEY = "__NEURA_QA_RATE_LIMIT_BUCKETS__" as const;
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: GlobalBucketStore };

function store(): GlobalBucketStore {
  const g = globalThis as GlobalWithStore;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = {};
  return g[GLOBAL_KEY]!;
}

/**
 * Rate limit sliding window.
 * - `key` identifica el bucket (p. ej. `"cred_put:" + userId`).
 * - `limit` requests permitidos por `windowMs`.
 *
 * Devuelve `null` si OK, o una `NextResponse` 429 si se excedió.
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number; now?: () => number }
): NextResponse | null {
  const now = (opts.now ?? Date.now)();
  const buckets = store();
  const bucket = buckets[key] ?? { hits: [] };

  // Dropear hits fuera de la ventana
  const cutoff = now - opts.windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= opts.limit) {
    const retryMs = bucket.hits[0]! + opts.windowMs - now;
    return NextResponse.json(
      {
        error: "Demasiadas requests. Esperá unos segundos.",
        code: "rate_limit",
        retry_after_ms: retryMs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(retryMs / 1000))),
          "X-RateLimit-Limit": String(opts.limit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  bucket.hits.push(now);
  buckets[key] = bucket;
  return null;
}

/** Testing helper: borra todos los buckets. No usar en runtime. */
export function __resetRateLimitForTests(): void {
  const g = globalThis as GlobalWithStore;
  g[GLOBAL_KEY] = {};
}
