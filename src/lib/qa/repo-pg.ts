/**
 * NEURA QA CENTER — implementación QaRunsRepo sobre pg.Pool directo.
 *
 * Reglas:
 *   - 100% consultas parametrizadas ($1, $2, …), nunca interpolación.
 *   - Transacciones donde haga falta atomicidad multi-statement.
 *   - Idempotencia enforzada por UNIQUEs del schema + `ON CONFLICT DO NOTHING`.
 *   - Liberación garantizada de conexiones (via withQaClient / withQaTransaction).
 *   - Nunca referencia tablas fuera de `qa_center.*`.
 *
 * Inyección del client: todos los métodos aceptan un `QaExecutor` opcional
 * (devoluciones y signatures idénticos a `pg.PoolClient.query`). Si no se
 * pasa, se usa el pool via helpers. Esto permite testear con mocks sin red.
 */

import type pg from "pg";
import { withQaClient, withQaTransaction } from "./pg-pool";
import type {
  ClaimedJob,
  FinishRunInput,
  QaFindingRow,
  QaProject,
  QaRun,
  QaRunnerJob,
  QaRunsRepo,
  QaSuite,
  ResultPayload,
} from "./repo-types";

/**
 * Shape mínima para inyectar un cliente de BD en tests sin colisionar con
 * las ~16 sobrecargas del `query` de pg.PoolClient. Un `pg.PoolClient` encaja
 * acá naturalmente.
 */
export type QaExecutor = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

const PROJECT_COLS =
  "id, slug, name, target_base_url, target_env, default_branch";
const SUITE_COLS =
  "id, project_id, slug, name, tags, specs, enabled";
const RUN_COLS =
  "id, project_id, suite_id, status, trigger, target_base_url, target_env, " +
  "triggered_by_user_id, triggered_by_ref, totals, env_assert_passed, " +
  "env_assert_response, summary, duration_ms, started_at, finished_at, created_at";
const JOB_COLS =
  "id, run_id, claimed_by, claimed_at, attempts, max_attempts, heartbeat_at, created_at";

function asProject(row: Record<string, unknown> | undefined): QaProject | null {
  if (!row) return null;
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    target_base_url: String(row.target_base_url),
    target_env: row.target_env as QaProject["target_env"],
    default_branch: String(row.default_branch),
  };
}
function asSuite(row: Record<string, unknown> | undefined): QaSuite | null {
  if (!row) return null;
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    slug: String(row.slug),
    name: String(row.name),
    tags: (row.tags as string[] | null) ?? [],
    specs: (row.specs as string[] | null) ?? [],
    enabled: Boolean(row.enabled),
  };
}
function asRun(row: Record<string, unknown>): QaRun {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    suite_id: String(row.suite_id),
    status: row.status as QaRun["status"],
    trigger: String(row.trigger),
    target_base_url: String(row.target_base_url),
    target_env: row.target_env as QaRun["target_env"],
    triggered_by_user_id: (row.triggered_by_user_id as string | null) ?? null,
    triggered_by_ref: (row.triggered_by_ref as string | null) ?? null,
    totals: (row.totals as QaRun["totals"]) ?? { passed: 0, failed: 0, skipped: 0, flaky: 0 },
    env_assert_passed: (row.env_assert_passed as boolean | null) ?? null,
    env_assert_response: (row.env_assert_response as unknown | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    duration_ms: (row.duration_ms as number | null) ?? null,
    started_at: (row.started_at as string | null) ?? null,
    finished_at: (row.finished_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}
function asJob(row: Record<string, unknown>): QaRunnerJob {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    claimed_by: (row.claimed_by as string | null) ?? null,
    claimed_at: (row.claimed_at as string | null) ?? null,
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    heartbeat_at: (row.heartbeat_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

// ────────────────────────────────────────────────────────────────────────────

export class PostgresQaRunsRepo implements QaRunsRepo {
  /**
   * Acepta un `QaExecutor` para tests (p.ej. un mock que implementa `.query`).
   * Si no se pasa, cada método toma su propia conexión del pool.
   */
  constructor(private readonly injected?: QaExecutor) {}

  private async run<T>(
    fn: (c: QaExecutor) => Promise<T>,
    tx = false
  ): Promise<T> {
    if (this.injected) return fn(this.injected);
    return tx ? withQaTransaction(fn) : withQaClient(fn);
  }

  async getProject(projectId: string): Promise<QaProject | null> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT ${PROJECT_COLS} FROM qa_center.projects
          WHERE id = $1 AND archived_at IS NULL LIMIT 1`,
        [projectId]
      );
      return asProject(r.rows[0]);
    });
  }

  async getSuite(suiteId: string): Promise<QaSuite | null> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT ${SUITE_COLS} FROM qa_center.suites WHERE id = $1 LIMIT 1`,
        [suiteId]
      );
      return asSuite(r.rows[0]);
    });
  }

  async createRunAndJob(input: {
    project: QaProject;
    suite: QaSuite;
    triggered_by_user_id: string | null;
    clientRequestId: string | null;
  }): Promise<{ run: QaRun; job: QaRunnerJob; created: boolean }> {
    return this.run(async (c) => {
      // Idempotencia por client_request_id (ventana 10 min).
      if (input.clientRequestId) {
        const existing = await c.query(
          `SELECT ${RUN_COLS} FROM qa_center.runs
            WHERE project_id = $1 AND suite_id = $2
              AND triggered_by_ref = $3
              AND created_at > now() - interval '10 minutes'
            LIMIT 1`,
          [input.project.id, input.suite.id, input.clientRequestId]
        );
        if (existing.rows[0]) {
          const run = asRun(existing.rows[0]);
          const j = await c.query(
            `SELECT ${JOB_COLS} FROM qa_center.runner_jobs WHERE run_id = $1 LIMIT 1`,
            [run.id]
          );
          if (j.rows[0]) {
            return { run, job: asJob(j.rows[0]), created: false };
          }
        }
      }

      const r = await c.query(
        `INSERT INTO qa_center.runs
           (project_id, suite_id, status, trigger, target_base_url, target_env,
            triggered_by_user_id, triggered_by_ref)
         VALUES ($1, $2, 'queued', 'manual', $3, $4, $5, $6)
         RETURNING ${RUN_COLS}`,
        [
          input.project.id,
          input.suite.id,
          input.project.target_base_url,
          input.project.target_env,
          input.triggered_by_user_id,
          input.clientRequestId,
        ]
      );
      const run = asRun(r.rows[0]);
      const j = await c.query(
        `INSERT INTO qa_center.runner_jobs (run_id) VALUES ($1)
         RETURNING ${JOB_COLS}`,
        [run.id]
      );
      return { run, job: asJob(j.rows[0]), created: true };
    }, /* tx = */ true);
  }

  async claimNextJob(workerId: string): Promise<ClaimedJob | null> {
    return this.run(async (c) => {
      // Llama la función del schema (atómica, FOR UPDATE SKIP LOCKED).
      const r = await c.query(
        `SELECT ${JOB_COLS} FROM qa_center.claim_next_job($1)`,
        [workerId]
      );
      const first = r.rows[0] as Record<string, unknown> | undefined;
      if (!first || first.id === null) return null;
      const job = asJob(first);

      // Transicionar el run a 'running'.
      const runR = await c.query(
        `UPDATE qa_center.runs
            SET status='running', started_at=now()
          WHERE id=$1 AND finished_at IS NULL
          RETURNING ${RUN_COLS}`,
        [job.run_id]
      );
      if (!runR.rows[0]) return null;
      const run = asRun(runR.rows[0]);
      const project = await this.getProject(run.project_id);
      const suite = await this.getSuite(run.suite_id);
      if (!project || !suite) return null;
      return { job, run, project, suite };
    });
  }

  async heartbeat(runId: string, workerId: string): Promise<void> {
    await this.run(async (c) => {
      await c.query(
        `UPDATE qa_center.runner_jobs
            SET heartbeat_at = now()
          WHERE run_id = $1 AND claimed_by = $2`,
        [runId, workerId]
      );
    });
  }

  async insertResultIdempotent(
    runId: string,
    result: ResultPayload
  ): Promise<"inserted" | "skipped"> {
    return this.run(async (c) => {
      const r = await c.query(
        `INSERT INTO qa_center.results
           (run_id, spec_file, test_title, status, duration_ms, retries,
            error_type, error_message, stack_trace)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (run_id, spec_file, test_title) DO NOTHING
         RETURNING id`,
        [
          runId,
          result.spec_file,
          result.test_title,
          result.status,
          result.duration_ms,
          result.retries,
          result.error_type,
          result.error_message,
          result.stack_trace,
        ]
      );
      return r.rows.length > 0 ? "inserted" : "skipped";
    });
  }

  async finishRunIdempotent(
    runId: string,
    workerId: string,
    input: FinishRunInput
  ): Promise<"finished" | "already_finished" | "not_owner"> {
    return this.run(async (c) => {
      // Chequear ownership (si hay job, debe pertenecer al worker).
      const owner = await c.query(
        `SELECT claimed_by FROM qa_center.runner_jobs WHERE run_id = $1 LIMIT 1`,
        [runId]
      );
      const claimed_by = (owner.rows[0]?.claimed_by as string | null) ?? null;
      if (claimed_by !== null && claimed_by !== workerId) return "not_owner";

      // UPDATE condicional atómico.
      const r = await c.query(
        `UPDATE qa_center.runs
            SET status=$2, totals=$3::jsonb, summary=$4, duration_ms=$5,
                env_assert_passed=$6, env_assert_response=$7::jsonb,
                finished_at=now()
          WHERE id=$1 AND finished_at IS NULL
          RETURNING id`,
        [
          runId,
          input.status,
          JSON.stringify(input.totals),
          input.summary,
          input.duration_ms,
          input.env_assert_passed,
          input.env_assert_response === null ? null : JSON.stringify(input.env_assert_response),
        ]
      );
      return r.rows.length > 0 ? "finished" : "already_finished";
    }, /* tx = */ true);
  }

  async listRecentRuns(limit: number): Promise<QaRun[]> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT ${RUN_COLS} FROM qa_center.runs
          ORDER BY created_at DESC LIMIT $1`,
        [Math.min(Math.max(limit, 1), 200)]
      );
      return r.rows.map(asRun);
    });
  }

  async getRun(runId: string): Promise<QaRun | null> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT ${RUN_COLS} FROM qa_center.runs WHERE id = $1 LIMIT 1`,
        [runId]
      );
      return r.rows[0] ? asRun(r.rows[0]) : null;
    });
  }

  async listActiveProjects(limit = 100): Promise<QaProject[]> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT ${PROJECT_COLS} FROM qa_center.projects
          WHERE archived_at IS NULL
          ORDER BY created_at DESC
          LIMIT $1`,
        [Math.min(Math.max(limit, 1), 200)]
      );
      return r.rows
        .map(asProject)
        .filter((p): p is QaProject => p !== null);
    });
  }

  async listSuitesForProject(projectId: string): Promise<QaSuite[]> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT ${SUITE_COLS} FROM qa_center.suites
          WHERE project_id = $1
          ORDER BY created_at DESC`,
        [projectId]
      );
      return r.rows
        .map(asSuite)
        .filter((s): s is QaSuite => s !== null);
    });
  }

  async createProject(input: {
    slug: string;
    name: string;
    target_base_url: string;
    target_env: QaProject["target_env"];
    default_branch?: string;
    owner_user_id?: string | null;
  }): Promise<QaProject | { conflict: "slug" }> {
    return this.run(async (c) => {
      const dup = await c.query(
        `SELECT 1 FROM qa_center.projects WHERE slug = $1 LIMIT 1`,
        [input.slug]
      );
      if (dup.rowCount && dup.rowCount > 0) return { conflict: "slug" } as const;
      const r = await c.query(
        `INSERT INTO qa_center.projects
           (slug, name, target_base_url, target_env, default_branch, owner_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${PROJECT_COLS}`,
        [
          input.slug,
          input.name,
          input.target_base_url,
          input.target_env,
          input.default_branch ?? "main",
          input.owner_user_id ?? null,
        ]
      );
      return asProject(r.rows[0]) as QaProject;
    }, /* tx = */ true);
  }

  async updateProject(
    projectId: string,
    patch: Partial<Pick<QaProject, "name" | "target_base_url" | "target_env" | "default_branch">>
  ): Promise<QaProject | null> {
    return this.run(async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (patch.name !== undefined) { sets.push(`name = $${i++}`); params.push(patch.name); }
      if (patch.target_base_url !== undefined) { sets.push(`target_base_url = $${i++}`); params.push(patch.target_base_url); }
      if (patch.target_env !== undefined) { sets.push(`target_env = $${i++}`); params.push(patch.target_env); }
      if (patch.default_branch !== undefined) { sets.push(`default_branch = $${i++}`); params.push(patch.default_branch); }
      if (sets.length === 0) return (await this.getProject(projectId));
      sets.push(`updated_at = now()`);
      params.push(projectId);
      const r = await c.query(
        `UPDATE qa_center.projects SET ${sets.join(", ")}
          WHERE id = $${i} AND archived_at IS NULL
          RETURNING ${PROJECT_COLS}`,
        params
      );
      return r.rows[0] ? asProject(r.rows[0]) : null;
    });
  }

  async createSuite(input: {
    project_id: string;
    slug: string;
    name: string;
    description?: string | null;
    tags?: string[];
    specs: string[];
    enabled?: boolean;
  }): Promise<QaSuite | { conflict: "slug" } | { conflict: "project_not_found" }> {
    return this.run(async (c) => {
      const pr = await c.query(
        `SELECT 1 FROM qa_center.projects WHERE id = $1 AND archived_at IS NULL LIMIT 1`,
        [input.project_id]
      );
      if (!pr.rowCount) return { conflict: "project_not_found" } as const;
      const dup = await c.query(
        `SELECT 1 FROM qa_center.suites WHERE project_id = $1 AND slug = $2 LIMIT 1`,
        [input.project_id, input.slug]
      );
      if (dup.rowCount && dup.rowCount > 0) return { conflict: "slug" } as const;
      const r = await c.query(
        `INSERT INTO qa_center.suites
           (project_id, slug, name, description, tags, specs, enabled)
         VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7)
         RETURNING ${SUITE_COLS}`,
        [
          input.project_id,
          input.slug,
          input.name,
          input.description ?? null,
          input.tags ?? [],
          input.specs,
          input.enabled ?? true,
        ]
      );
      return asSuite(r.rows[0]) as QaSuite;
    }, /* tx = */ true);
  }

  async updateSuite(
    suiteId: string,
    patch: Partial<Pick<QaSuite, "name" | "tags" | "specs" | "enabled">>
  ): Promise<QaSuite | null> {
    return this.run(async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (patch.name !== undefined) { sets.push(`name = $${i++}`); params.push(patch.name); }
      if (patch.tags !== undefined) { sets.push(`tags = $${i++}::text[]`); params.push(patch.tags); }
      if (patch.specs !== undefined) { sets.push(`specs = $${i++}::text[]`); params.push(patch.specs); }
      if (patch.enabled !== undefined) { sets.push(`enabled = $${i++}`); params.push(patch.enabled); }
      if (sets.length === 0) return this.getSuite(suiteId);
      sets.push(`updated_at = now()`);
      params.push(suiteId);
      const r = await c.query(
        `UPDATE qa_center.suites SET ${sets.join(", ")}
          WHERE id = $${i}
          RETURNING ${SUITE_COLS}`,
        params
      );
      return r.rows[0] ? asSuite(r.rows[0]) : null;
    });
  }

  async listFindings(opts: { projectId?: string; limit?: number } = {}): Promise<QaFindingRow[]> {
    return this.run(async (c) => {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      const cols =
        "id, project_id, run_id, result_id, title, description, severity, status, " +
        "triage_notes, external_ticket_ref, created_at, updated_at";
      const r = opts.projectId
        ? await c.query(
            `SELECT ${cols} FROM qa_center.findings
              WHERE project_id = $1
              ORDER BY
                CASE severity
                  WHEN 'blocker' THEN 0 WHEN 'critical' THEN 1 WHEN 'major' THEN 2
                  WHEN 'minor' THEN 3 ELSE 4 END,
                created_at DESC
              LIMIT $2`,
            [opts.projectId, limit]
          )
        : await c.query(
            `SELECT ${cols} FROM qa_center.findings
              ORDER BY
                CASE severity
                  WHEN 'blocker' THEN 0 WHEN 'critical' THEN 1 WHEN 'major' THEN 2
                  WHEN 'minor' THEN 3 ELSE 4 END,
                created_at DESC
              LIMIT $1`,
            [limit]
          );
      return r.rows.map((row): QaFindingRow => ({
        id: String(row.id),
        project_id: String(row.project_id),
        run_id: (row.run_id as string | null) ?? null,
        result_id: (row.result_id as string | null) ?? null,
        title: String(row.title),
        description: (row.description as string | null) ?? null,
        severity: row.severity as QaFindingRow["severity"],
        status: row.status as QaFindingRow["status"],
        triage_notes: (row.triage_notes as string | null) ?? null,
        external_ticket_ref: (row.external_ticket_ref as string | null) ?? null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      }));
    });
  }

  async listResultsForRun(runId: string): Promise<ResultPayload[]> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT spec_file, test_title, status, duration_ms, retries,
                error_type, error_message, stack_trace
           FROM qa_center.results WHERE run_id = $1
           ORDER BY spec_file, test_title`,
        [runId]
      );
      return r.rows.map((row): ResultPayload => ({
        spec_file: String(row.spec_file),
        test_title: String(row.test_title),
        status: row.status as ResultPayload["status"],
        duration_ms: (row.duration_ms as number | null) ?? null,
        retries: Number(row.retries ?? 0),
        error_type: (row.error_type as string | null) ?? null,
        error_message: (row.error_message as string | null) ?? null,
        stack_trace: (row.stack_trace as string | null) ?? null,
      }));
    });
  }
}
