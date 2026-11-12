/**
 * NEURA QA CENTER — acceso de lectura al esquema `qa_center`.
 * MVP-2 solo lee. Las mutaciones (POST/PATCH/DELETE) llegarán en fases siguientes.
 *
 * Importante: el esquema `qa_center` NO está expuesto por PostgREST hasta que
 * un humano lo agregue manualmente a `supabase/config.toml :: [api].schemas`.
 * Mientras eso no ocurra, las queries acá devuelven un error reconocible y los
 * endpoints responden con un estado "migration_pending" vacío, sin fingir datos.
 */

import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type QaMigrationStatus = "ready" | "schema_not_exposed" | "table_missing";

export type QaListResult<T> = {
  data: T[];
  migration_status: QaMigrationStatus;
  note?: string;
};

/**
 * Error que devuelve PostgREST cuando el esquema no está en `[api].schemas`
 * de `supabase/config.toml`. Observado contra Supabase self-hosted v2.
 *   code: "PGRST106" o mensaje "schema \"qa_center\" is not in exposed schemas"
 *
 * Tambien cubrimos el caso "relation ... does not exist" si la migración
 * todavía no corrió (code 42P01).
 */
export function classifyQaReadError(err: {
  code?: string | null;
  message?: string | null;
}): QaMigrationStatus {
  const code = (err.code ?? "").toUpperCase();
  const msg = (err.message ?? "").toLowerCase();
  if (code === "PGRST106" || msg.includes("not in exposed schemas")) {
    return "schema_not_exposed";
  }
  if (code === "42P01" || msg.includes("does not exist")) {
    return "table_missing";
  }
  return "ready";
}

export type QaProjectRow = {
  id: string;
  slug: string;
  name: string;
  repo_url: string | null;
  default_branch: string;
  target_base_url: string;
  target_env: "staging" | "preview" | "local";
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listQaProjects(
  client: AppSupabaseClient
): Promise<QaListResult<QaProjectRow>> {
  const { data, error } = await client
    .schema("qa_center")
    .from("projects")
    .select(
      "id, slug, name, repo_url, default_branch, target_base_url, target_env, archived_at, created_at, updated_at"
    )
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    const status = classifyQaReadError(error);
    if (status !== "ready") {
      return {
        data: [],
        migration_status: status,
        note:
          status === "schema_not_exposed"
            ? "El esquema qa_center aún no está en [api].schemas de Supabase."
            : "La migración 20261112000000_qa_center_schema.sql aún no fue aplicada.",
      };
    }
    throw error;
  }
  return { data: (data as QaProjectRow[]) ?? [], migration_status: "ready" };
}

export type QaRunRow = {
  id: string;
  project_id: string;
  suite_id: string;
  trigger: string;
  status: string;
  target_base_url: string;
  target_env: "staging" | "preview" | "local";
  env_assert_passed: boolean | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  totals: Record<string, number>;
  created_at: string;
};

export async function listQaRuns(
  client: AppSupabaseClient,
  opts: { projectId?: string; limit?: number } = {}
): Promise<QaListResult<QaRunRow>> {
  let q = client
    .schema("qa_center")
    .from("runs")
    .select(
      "id, project_id, suite_id, trigger, status, target_base_url, target_env, env_assert_passed, started_at, finished_at, duration_ms, totals, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 25);

  if (opts.projectId) q = q.eq("project_id", opts.projectId);

  const { data, error } = await q;
  if (error) {
    const status = classifyQaReadError(error);
    if (status !== "ready") {
      return {
        data: [],
        migration_status: status,
        note:
          status === "schema_not_exposed"
            ? "El esquema qa_center aún no está en [api].schemas de Supabase."
            : "La migración 20261112000000_qa_center_schema.sql aún no fue aplicada.",
      };
    }
    throw error;
  }
  return { data: (data as QaRunRow[]) ?? [], migration_status: "ready" };
}

export type QaSuiteRow = {
  id: string;
  project_id: string;
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  enabled: boolean;
  created_at: string;
};

export async function listQaSuites(
  client: AppSupabaseClient,
  projectId?: string
): Promise<QaListResult<QaSuiteRow>> {
  let q = client
    .schema("qa_center")
    .from("suites")
    .select("id, project_id, slug, name, description, tags, enabled, created_at")
    .order("created_at", { ascending: false });
  if (projectId) q = q.eq("project_id", projectId);

  const { data, error } = await q;
  if (error) {
    const status = classifyQaReadError(error);
    if (status !== "ready") {
      return {
        data: [],
        migration_status: status,
        note:
          status === "schema_not_exposed"
            ? "El esquema qa_center aún no está en [api].schemas de Supabase."
            : "La migración 20261112000000_qa_center_schema.sql aún no fue aplicada.",
      };
    }
    throw error;
  }
  return { data: (data as QaSuiteRow[]) ?? [], migration_status: "ready" };
}
