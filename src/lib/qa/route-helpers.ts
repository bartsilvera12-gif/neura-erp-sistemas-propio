/**
 * Helpers compartidos entre rutas /api/qa/*.
 * Resuelve el repo Supabase para usar en producción; para tests el repo se
 * pasa inyectado directamente al handler.
 */

import { createClient } from "@supabase/supabase-js";
import {
  supabaseServiceRoleClientOptions,
  type AppSupabaseClient,
} from "@/lib/supabase/schema";
import { SupabaseQaRunsRepo } from "./repo-supabase";
import { SupabaseNonceStore, type NonceStore } from "./nonce-store";
import type { QaRunsRepo } from "./repo-types";

export function buildSupabaseClient(): AppSupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { ...supabaseServiceRoleClientOptions });
}

export function buildSupabaseRepo(): QaRunsRepo | null {
  const client = buildSupabaseClient();
  return client ? new SupabaseQaRunsRepo(client) : null;
}

export function buildNonceStore(): NonceStore | null {
  const client = buildSupabaseClient();
  return client ? new SupabaseNonceStore(client) : null;
}
