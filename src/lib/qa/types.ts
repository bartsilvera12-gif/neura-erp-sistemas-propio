/**
 * NEURA QA CENTER — tipos compartidos entre API, UI y runner.
 * Fase 1 (MVP-1): solo lo mínimo para `/api/qa/env-assert` y futuros endpoints.
 * Aditivo: no reexporta ni extiende tipos de otros módulos.
 */

export type QaTargetEnv = "staging" | "preview" | "local";

export type QaIntegrationsMode = {
  whatsapp: "sandbox" | "disabled" | "live";
  smtp: "mailhog" | "mailtrap" | "disabled" | "live";
  sifen: "test" | "disabled" | "prod";
  push: "disabled" | "sandbox" | "live";
};

/**
 * Respuesta del endpoint `/api/qa/env-assert`.
 * El runner valida ANTES de abrir el browser:
 *   - `env` debe ser distinto de "production"
 *   - `prod_safe` debe ser true
 *   - ninguna integración debe estar en "live"
 *   - `supabase_ref` no debe coincidir con la lista hard-coded de refs prod
 */
export type QaEnvAssertResponse = {
  /** "staging" | "preview" | "local". En producción se devuelve 403, nunca "production" aquí. */
  env: QaTargetEnv;
  /** Hostname del Supabase que está usando este deploy (no la URL completa, no la key). */
  supabase_host: string;
  /** Referencia corta derivada del JWT iss del Supabase (no la key). Para comparar con lista negra. */
  supabase_ref: string | null;
  /** Modo de cada integración externa. */
  integrations: QaIntegrationsMode;
  /** Timestamp ISO del servidor target cuando respondió. */
  server_time: string;
  /** Commit sha del deploy (útil para correlacionar runs con código). */
  commit_sha: string | null;
  /**
   * `true` solo si TODAS estas condiciones se cumplen a la vez:
   *   env !== "production",
   *   integraciones no "live",
   *   supabase_host no está en la lista PROD_SUPABASE_HOSTS.
   * Si es `false` el runner DEBE abortar.
   */
  prod_safe: boolean;
  /** Motivos legibles por si `prod_safe=false`. Nunca contiene secretos. */
  reasons: string[];
};

/** Error estándar que devuelven las rutas `/api/qa/*`. */
export type QaApiError = {
  error: string;
  code:
    | "unauthorized"
    | "forbidden_production"
    | "not_found"
    | "validation"
    | "internal";
  detail?: string;
};
