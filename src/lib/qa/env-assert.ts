/**
 * NEURA QA CENTER — helpers para evaluar el entorno de ejecución del ERP.
 * Fase 1 (MVP-1): usado por `/api/qa/env-assert` para armar la respuesta y por
 * utilidades del lado servidor que necesitan saber si corren fuera de producción.
 *
 * Reglas:
 *   - Jamás expone secretos (keys, tokens, passwords, URLs con credenciales).
 *   - Jamás dice "production". En producción el endpoint devuelve 403.
 *   - La detección de entorno es por variables de entorno, no por hostname.
 */

import type {
  QaEnvAssertResponse,
  QaIntegrationsMode,
  QaTargetEnv,
} from "@/lib/qa/types";

/**
 * Hosts Supabase conocidos como productivos. Hard-coded: cualquier deploy
 * cuyo NEXT_PUBLIC_SUPABASE_URL apunte a uno de estos es tratado como prod.
 * No incluye rutas ni credenciales, solo hostnames.
 */
export const PROD_SUPABASE_HOSTS: ReadonlyArray<string> = [
  "api.neura.com.py",
];

/**
 * Lee la lista blanca de hosts Supabase autorizados para QA. Vacía por defecto.
 * Un deploy NO entra en modo QA (prod_safe=true) si su host no está acá, aunque
 * declare `QA_ENV=staging`. Esto evita que una `.env` mal configurada o una
 * variable declarativa sola habiliten el runner contra producción.
 */
export function readAllowedQaHosts(): ReadonlyArray<string> {
  return (process.env.QA_ALLOWED_SUPABASE_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export type QaEnvDetection =
  | { kind: "production" }
  | { kind: "non_production"; env: QaTargetEnv; reasons: string[] };

/**
 * Decide si el deploy actual es producción.
 * Fuente de verdad (en orden):
 *   1. `QA_ENV` explícita: "staging" | "preview" | "local" | "production".
 *   2. `NODE_ENV === "development"` → "local".
 *   3. `VERCEL_ENV === "preview"` → "preview".
 *   4. Fallback: "production" (seguridad por defecto).
 *
 * El hostname NUNCA se usa como criterio para "staging": una URL que diga
 * "qa" o "staging" no basta.
 */
export function detectEnv(): QaEnvDetection {
  const reasons: string[] = [];
  const raw = (process.env.QA_ENV ?? "").trim().toLowerCase();

  if (raw === "production") return { kind: "production" };
  if (raw === "staging" || raw === "preview" || raw === "local") {
    reasons.push(`QA_ENV=${raw}`);
    // Doble chequeo: si Supabase apunta a un host de prod, se degrada a producción.
    const host = currentSupabaseHost();
    if (host && PROD_SUPABASE_HOSTS.includes(host)) {
      return { kind: "production" };
    }
    return { kind: "non_production", env: raw, reasons };
  }

  if ((process.env.NODE_ENV ?? "").toLowerCase() === "development") {
    reasons.push("NODE_ENV=development");
    return { kind: "non_production", env: "local", reasons };
  }

  if ((process.env.VERCEL_ENV ?? "").toLowerCase() === "preview") {
    reasons.push("VERCEL_ENV=preview");
    return { kind: "non_production", env: "preview", reasons };
  }

  return { kind: "production" };
}

/** Extrae el hostname del NEXT_PUBLIC_SUPABASE_URL sin credenciales. */
export function currentSupabaseHost(): string | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Deriva un "ref" corto del JWT del Supabase ANON KEY, sin exponer la key.
 * El `iss` suele ser "supabase" en self-host; devolvemos su hash corto + `aud`.
 * Si no se puede parsear, devolvemos null.
 */
export function currentSupabaseRef(): string | null {
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!key) return null;
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    const iss = typeof payload.iss === "string" ? payload.iss : "";
    const ref = typeof payload.ref === "string" ? payload.ref : "";
    // `ref` solo existe en Supabase cloud; en self-host usamos iss + iat.
    const iat = typeof payload.iat === "number" ? payload.iat : 0;
    return ref || (iss ? `${iss}:${iat}` : null);
  } catch {
    return null;
  }
}

/** Lee el modo de integraciones externas desde env (nombres, no valores). */
export function detectIntegrations(): QaIntegrationsMode {
  // Si ALLOW_TEST_MODE está encendido asumimos sandbox para WhatsApp.
  const allowTest = (process.env.ALLOW_TEST_MODE ?? "").toLowerCase() === "true";
  const sifen = (process.env.SIFEN_MODE ?? "").toLowerCase();
  const smtp = (process.env.SMTP_HOST ?? "").toLowerCase();

  return {
    whatsapp: allowTest ? "sandbox" : "live",
    smtp: smtp.includes("mailhog")
      ? "mailhog"
      : smtp.includes("mailtrap")
      ? "mailtrap"
      : smtp
      ? "live"
      : "disabled",
    sifen: sifen === "test" ? "test" : sifen === "disabled" ? "disabled" : "prod",
    push: process.env.FIREBASE_PROJECT_ID ? "live" : "disabled",
  };
}

/**
 * Arma la respuesta pública de `/api/qa/env-assert` cuando el entorno NO es prod.
 * Si es prod, la ruta devuelve 403 y esta función no debe llamarse.
 */
export function buildEnvAssertResponse(detection: {
  env: QaTargetEnv;
  reasons: string[];
}): QaEnvAssertResponse {
  const host = currentSupabaseHost() ?? "(sin configurar)";
  const hostLower = host.toLowerCase();
  const integrations = detectIntegrations();
  const supabaseIsProd = PROD_SUPABASE_HOSTS.includes(hostLower);
  const integrationsLive = Object.values(integrations).some((v) => v === "live");
  const allowedHosts = readAllowedQaHosts();
  const hostInAllowList = allowedHosts.includes(hostLower);
  const allowListConfigured = allowedHosts.length > 0;

  const reasons = [...detection.reasons];
  // Defensa en profundidad: `QA_ENV` declarativa NO alcanza. Requerimos que
  // el host Supabase esté explícitamente permitido via `QA_ALLOWED_SUPABASE_HOSTS`.
  const prod_safe =
    !supabaseIsProd && !integrationsLive && allowListConfigured && hostInAllowList;

  if (supabaseIsProd) reasons.push(`supabase_host=${host} está en PROD_SUPABASE_HOSTS`);
  if (integrationsLive) reasons.push("una integración está en modo live");
  if (!allowListConfigured) {
    reasons.push("QA_ALLOWED_SUPABASE_HOSTS no está configurado");
  } else if (!hostInAllowList) {
    reasons.push(`supabase_host=${host} no está en QA_ALLOWED_SUPABASE_HOSTS`);
  }

  return {
    env: detection.env,
    supabase_host: host,
    supabase_ref: currentSupabaseRef(),
    integrations,
    server_time: new Date().toISOString(),
    commit_sha:
      (process.env.SOURCE_COMMIT ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        null) || null,
    prod_safe,
    reasons,
  };
}
