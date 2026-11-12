/**
 * Helpers compartidos entre rutas /api/qa/*.
 * Resuelve el repo Supabase para usar en producción; para tests el repo se
 * pasa inyectado directamente al handler.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { SupabaseQaRunsRepo } from "./repo-supabase";
import type { QaRunsRepo } from "./repo-types";

export function buildSupabaseRepo(): QaRunsRepo | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, { ...supabaseServiceRoleClientOptions });
  return new SupabaseQaRunsRepo(client);
}
