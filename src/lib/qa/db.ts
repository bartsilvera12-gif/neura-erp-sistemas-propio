/**
 * NEURA QA CENTER — fachada de lectura basada EXCLUSIVAMENTE en el adaptador
 * Postgres directo (`PostgresQaRunsRepo`). NO usa Supabase REST ni service_role.
 *
 * Mantenemos los nombres (`listQaProjects`, `listQaRuns`, `listQaSuites`,
 * `QaListResult`, `QaProjectRow`, `QaRunRow`, `QaSuiteRow`, `classifyQaReadError`)
 * por compatibilidad con los imports de la UI y las rutas GET existentes.
 *
 * Si `QA_DB_URL` no está configurada, devolvemos `{ data: [], migration_status:
 * "config_missing" }` para que la UI muestre un banner claro y fail-closed.
 */

import { buildQaRepo } from "./route-helpers";
import type { QaProject, QaRun, QaSuite } from "./repo-types";

export type QaMigrationStatus =
  | "ready"
  | "schema_not_exposed"
  | "table_missing"
  | "config_missing";

export type QaListResult<T> = {
  data: T[];
  migration_status: QaMigrationStatus;
  note?: string;
};

// Tipos "row" que la UI consume (shape mínima).
export type QaProjectRow = {
  id: string;
  slug: string;
  name: string;
  repo_url: string | null;
  default_branch: string;
  target_base_url: string;
  target_env: QaProject["target_env"];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  estado_entrega: "en_desarrollo" | "en_qa" | "entregado";
  autorizacion_qa_hasta: string | null;
};

export type QaRunRow = {
  id: string;
  project_id: string;
  suite_id: string;
  trigger: string;
  status: string;
  target_base_url: string;
  target_env: QaRun["target_env"];
  env_assert_passed: boolean | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  totals: Record<string, number>;
  created_at: string;
};

export type QaSuiteRow = QaSuite;

/**
 * Compatibilidad hacia atrás: antes se usaba para clasificar errores
 * PostgREST (PGRST106, 42P01). Hoy, con PG directo, los errores de
 * conectividad se traducen a `config_missing` o se dejan propagar.
 */
export function classifyQaReadError(_err: {
  code?: string | null;
  message?: string | null;
}): QaMigrationStatus {
  return "ready";
}

function noConfig<T>(): QaListResult<T> {
  return {
    data: [],
    migration_status: "config_missing",
    note: "QA_DB_URL no configurada — QA Center fail-closed.",
  };
}

function projectToRow(p: QaProject): QaProjectRow {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    repo_url: null,
    default_branch: p.default_branch,
    target_base_url: p.target_base_url,
    target_env: p.target_env,
    archived_at: null,
    created_at: "",
    updated_at: "",
    estado_entrega: p.estado_entrega,
    autorizacion_qa_hasta: p.autorizacion_qa_hasta,
  };
}

function runToRow(r: QaRun): QaRunRow {
  return {
    id: r.id,
    project_id: r.project_id,
    suite_id: r.suite_id,
    trigger: r.trigger,
    status: r.status,
    target_base_url: r.target_base_url,
    target_env: r.target_env,
    env_assert_passed: r.env_assert_passed,
    started_at: r.started_at,
    finished_at: r.finished_at,
    duration_ms: r.duration_ms,
    totals: r.totals as unknown as Record<string, number>,
    created_at: r.created_at,
  };
}

export async function listQaProjects(limit = 100): Promise<QaListResult<QaProjectRow>> {
  const repo = buildQaRepo();
  if (!repo) return noConfig();
  const rows = await repo.listActiveProjects(limit);
  return { data: rows.map(projectToRow), migration_status: "ready" };
}

export async function listQaRuns(
  opts: { projectId?: string; limit?: number } = {}
): Promise<QaListResult<QaRunRow>> {
  const repo = buildQaRepo();
  if (!repo) return noConfig();
  const limit = opts.limit ?? 25;
  const all = await repo.listRecentRuns(limit);
  const filtered = opts.projectId
    ? all.filter((r) => r.project_id === opts.projectId)
    : all;
  return { data: filtered.map(runToRow), migration_status: "ready" };
}

export async function listQaSuites(
  projectId?: string
): Promise<QaListResult<QaSuiteRow>> {
  const repo = buildQaRepo();
  if (!repo) return noConfig();
  if (!projectId) {
    // Sin projectId no listamos (la UI siempre pasa uno).
    return { data: [], migration_status: "ready" };
  }
  const rows = await repo.listSuitesForProject(projectId);
  return { data: rows, migration_status: "ready" };
}
