/**
 * Helpers compartidos entre rutas /api/qa/*.
 *
 * Fail-closed: si `QA_DB_URL` no está configurada, QA Center NO opera.
 * NO hay fallback a Supabase REST, autorizado previamente — la expectativa
 * explícita es que QA Center acceda EXCLUSIVAMENTE vía Postgres directo con
 * el rol `qa_center_api` de permisos mínimos.
 *
 * Las impls Supabase quedan en el repo como material histórico y para tests
 * con mocks, pero no se cablean desde las rutas.
 */

import { PostgresQaRunsRepo } from "./repo-pg";
import { PostgresNonceStore } from "./nonce-store-pg";
import { getQaPool } from "./pg-pool";
import type { QaRunsRepo } from "./repo-types";
import type { NonceStore } from "./nonce-store";

/**
 * Devuelve el repo PG si `QA_DB_URL` está seteada; `null` si no.
 * Las rutas deben traducir `null` a HTTP 500 para que no pasen al handler.
 */
export function buildQaRepo(): QaRunsRepo | null {
  if (!getQaPool()) return null;
  return new PostgresQaRunsRepo();
}

export function buildQaNonceStore(): NonceStore | null {
  if (!getQaPool()) return null;
  return new PostgresNonceStore();
}
