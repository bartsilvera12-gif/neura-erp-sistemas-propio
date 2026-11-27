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
import { puedeEjecutarRun } from "./project-estado";
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
  "id, slug, name, target_base_url, target_env, default_branch, " +
  "estado_entrega, autorizacion_qa_hasta, repo_url, permite_lectura_sin_env_assert, " +
  "tipo_proyecto";
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
    estado_entrega: (row.estado_entrega as QaProject["estado_entrega"]) ?? "en_desarrollo",
    autorizacion_qa_hasta: (row.autorizacion_qa_hasta as string | null) ?? null,
    repo_url: (row.repo_url as string | null) ?? null,
    permite_lectura_sin_env_assert: row.permite_lectura_sin_env_assert === true,
    tipo_proyecto: (row.tipo_proyecto === "web" ? "web" : "erp") as QaProject["tipo_proyecto"],
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
    // Transacción: si el gate `puedeEjecutarRun` rechaza, el ROLLBACK deshace
    // `claim_next_job` (que marca claimed_by + attempts++) y el UPDATE a
    // 'running'. Antes del fix, un claim rechazado dejaba el run como
    // "running fantasma" (sin eventos y sin heartbeat progresando) hasta que
    // el reaper lo liberaba, generando apariencia de cuelgue del runner.
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT ${JOB_COLS} FROM qa_center.claim_next_job($1)`,
        [workerId]
      );
      const first = r.rows[0] as Record<string, unknown> | undefined;
      if (!first || first.id === null) return null;
      const job = asJob(first);

      // Leer run + project ANTES de transicionar a running, para validar
      // el gate de ciclo de vida sin dejar huella si la autorización no
      // está vigente.
      const preRun = await c.query(
        `SELECT ${RUN_COLS} FROM qa_center.runs WHERE id=$1`,
        [job.run_id]
      );
      if (!preRun.rows[0]) {
        throw new Error("qa_claim_rollback: run no existe");
      }
      const runPre = asRun(preRun.rows[0]);
      const projectRows = await c.query(
        `SELECT id, slug, name, repo_url, default_branch, target_base_url, target_env,
                owner_user_id, created_at, updated_at, archived_at,
                estado_entrega, autorizacion_qa_hasta, permite_lectura_sin_env_assert
           FROM qa_center.projects WHERE id=$1`,
        [runPre.project_id]
      );
      const projectRow = projectRows.rows[0];
      if (!projectRow) {
        throw new Error("qa_claim_rollback: project no existe");
      }

      // BYPASS del gate de autorización para modos que NO tocan el ERP real:
      //  - ai-interaction-*  → sandbox (copia efímera, allowlist de hosts)
      //  - ai-discovery-*    → sólo análisis de repo, no ejecuta contra ERP
      // Estos modos están protegidos por sus propios allowlists en el runner;
      // exigir autorización 72h acá bloqueaba ejecuciones legítimas.
      // El estado "entregado" SÍ sigue bloqueando (el cliente ya opera en prod).
      const suiteSlugRes = await c.query(
        `SELECT slug FROM qa_center.suites WHERE id = $1`,
        [runPre.suite_id]
      );
      const suiteSlug = String(suiteSlugRes.rows[0]?.slug ?? "");
      const esSandboxOSoloAnalisis =
        suiteSlug.startsWith("ai-interaction-") || suiteSlug.startsWith("ai-discovery-");

      if (projectRow.estado_entrega === "entregado" && !esSandboxOSoloAnalisis) {
        const err = new Error("El proyecto fue entregado — QA está bloqueado.") as Error & { qaClaimRejected?: string };
        err.qaClaimRejected = "entregado";
        throw err;
      }

      if (!esSandboxOSoloAnalisis) {
        const veredicto = puedeEjecutarRun({
          estado_entrega: projectRow.estado_entrega as "en_desarrollo" | "en_qa" | "entregado",
          autorizacion_qa_hasta: (projectRow.autorizacion_qa_hasta as string | Date | null)?.toString() ?? null,
        });
        if (!veredicto.ok) {
          const err = new Error(veredicto.razon) as Error & { qaClaimRejected?: typeof veredicto.codigo };
          err.qaClaimRejected = veredicto.codigo;
          throw err;
        }
      }

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
    }, /* tx = */ true);
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
    repo_url?: string | null;
    tipo_proyecto?: QaProject["tipo_proyecto"];
  }): Promise<QaProject | { conflict: "slug" }> {
    return this.run(async (c) => {
      const dup = await c.query(
        `SELECT 1 FROM qa_center.projects WHERE slug = $1 LIMIT 1`,
        [input.slug]
      );
      if (dup.rowCount && dup.rowCount > 0) return { conflict: "slug" } as const;
      const r = await c.query(
        `INSERT INTO qa_center.projects
           (slug, name, target_base_url, target_env, default_branch, owner_user_id, repo_url, tipo_proyecto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${PROJECT_COLS}`,
        [
          input.slug,
          input.name,
          input.target_base_url,
          input.target_env,
          input.default_branch ?? "main",
          input.owner_user_id ?? null,
          input.repo_url ?? null,
          input.tipo_proyecto ?? "erp",
        ]
      );
      return asProject(r.rows[0]) as QaProject;
    }, /* tx = */ true);
  }

  async updateProject(
    projectId: string,
    patch: Partial<Pick<QaProject, "name" | "target_base_url" | "target_env" | "default_branch" | "repo_url" | "tipo_proyecto">>
  ): Promise<QaProject | null> {
    return this.run(async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (patch.name !== undefined) { sets.push(`name = $${i++}`); params.push(patch.name); }
      if (patch.target_base_url !== undefined) { sets.push(`target_base_url = $${i++}`); params.push(patch.target_base_url); }
      if (patch.target_env !== undefined) { sets.push(`target_env = $${i++}`); params.push(patch.target_env); }
      if (patch.default_branch !== undefined) { sets.push(`default_branch = $${i++}`); params.push(patch.default_branch); }
      if (patch.repo_url !== undefined) { sets.push(`repo_url = $${i++}`); params.push(patch.repo_url); }
      if (patch.tipo_proyecto !== undefined) { sets.push(`tipo_proyecto = $${i++}`); params.push(patch.tipo_proyecto); }
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

  async archiveProject(projectId: string): Promise<boolean> {
    return this.run(async (c) => {
      const r = await c.query(
        `UPDATE qa_center.projects
           SET archived_at = now(), updated_at = now()
         WHERE id = $1 AND archived_at IS NULL`,
        [projectId]
      );
      return (r.rowCount ?? 0) > 0;
    }, /* tx = */ true);
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

  async autorizarProyecto(input: {
    project_id: string;
    usuario_id: string | null;
    declaraciones: Record<string, boolean>;
    autorizado_hasta: string;
  }): Promise<QaProject | null> {
    return this.run(async (c) => {
      await c.query(
        `INSERT INTO qa_center.project_autorizaciones
           (project_id, usuario_id, declaraciones, autorizado_hasta)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [input.project_id, input.usuario_id, JSON.stringify(input.declaraciones), input.autorizado_hasta]
      );
      const r = await c.query(
        `UPDATE qa_center.projects
            SET estado_entrega = 'en_qa',
                autorizacion_qa_hasta = $2,
                updated_at = now()
          WHERE id = $1 AND archived_at IS NULL AND estado_entrega <> 'entregado'
          RETURNING ${PROJECT_COLS}`,
        [input.project_id, input.autorizado_hasta]
      );
      await c.query(
        `INSERT INTO qa_center.audit_log (actor, action, entity_type, entity_id, payload)
         VALUES ($1, 'project_autorizar', 'project', $2, $3::jsonb)`,
        [input.usuario_id ?? "system", input.project_id, JSON.stringify({ autorizado_hasta: input.autorizado_hasta })]
      );
      return r.rows[0] ? asProject(r.rows[0]) : null;
    }, /* tx = */ true);
  }

  async entregarProyecto(input: { project_id: string; usuario_id: string | null }): Promise<QaProject | null> {
    return this.run(async (c) => {
      const r = await c.query(
        `UPDATE qa_center.projects
            SET estado_entrega = 'entregado',
                autorizacion_qa_hasta = NULL,
                updated_at = now()
          WHERE id = $1 AND archived_at IS NULL
          RETURNING ${PROJECT_COLS}`,
        [input.project_id]
      );
      if (r.rows[0]) {
        await c.query(
          `INSERT INTO qa_center.audit_log (actor, action, entity_type, entity_id)
           VALUES ($1, 'project_entregar', 'project', $2)`,
          [input.usuario_id ?? "system", input.project_id]
        );
      }
      return r.rows[0] ? asProject(r.rows[0]) : null;
    }, /* tx = */ true);
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

  async insertFindings(input: {
    run_id: string;
    project_id: string;
    findings: Array<{
      title: string;
      description: string;
      severity: QaFindingRow["severity"];
      funcion_revisada?: string | null;
      resultado_esperado?: string | null;
      resultado_obtenido?: string | null;
      recomendacion?: string | null;
      evidencia_url?: string | null;
      modulo_negocio?: string | null;
    }>;
  }): Promise<{ inserted: number }> {
    if (input.findings.length === 0) return { inserted: 0 };
    return this.run(async (c) => {
      // Batch INSERT en una sola query con VALUES posicionales.
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let i = 1;
      for (const f of input.findings) {
        placeholders.push(
          `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}::qa_center.finding_severity, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`
        );
        values.push(
          input.project_id,
          input.run_id,
          f.title,
          f.description,
          f.severity,
          f.funcion_revisada ?? null,
          f.resultado_esperado ?? null,
          f.resultado_obtenido ?? null,
          f.recomendacion ?? null,
          f.evidencia_url ?? null,
          f.modulo_negocio ?? null
        );
      }
      const r = await c.query(
        `INSERT INTO qa_center.findings
           (project_id, run_id, title, description, severity,
            funcion_revisada, resultado_esperado, resultado_obtenido,
            recomendacion, evidencia_url, modulo_negocio)
         VALUES ${placeholders.join(", ")}
         RETURNING id`,
        values
      );
      return { inserted: r.rowCount ?? 0 };
    }, /* tx = */ true);
  }

  async setPermiteLecturaSinEnvAssert(input: {
    project_id: string;
    valor: boolean;
    actor_id: string | null;
  }): Promise<QaProject | null> {
    return this.run(async (c) => {
      const r = await c.query(
        `UPDATE qa_center.projects
            SET permite_lectura_sin_env_assert = $2,
                updated_at = now()
          WHERE id = $1
        RETURNING ${PROJECT_COLS}, permite_lectura_sin_env_assert`,
        [input.project_id, input.valor]
      );
      if (r.rowCount === 0) return null;
      const row = r.rows[0] as Record<string, unknown>;
      await c.query(
        `INSERT INTO qa_center.audit_log (actor, action, entity_type, entity_id, payload)
         VALUES ($1, 'set_permite_lectura_sin_env_assert', 'project', $2, $3::jsonb)`,
        [input.actor_id ?? "system", input.project_id, JSON.stringify({ valor: input.valor })]
      );
      const proj = asProject(row);
      if (!proj) return null;
      return { ...proj, permite_lectura_sin_env_assert: row.permite_lectura_sin_env_assert === true };
    }, /* tx = */ true);
  }

  // ── Analizar ERP (pipeline IA) ──────────────────────────────────────────

  async insertErpDiscovery(input: {
    project_id: string;
    run_id: string;
    commit_sha: string | null;
    codebase: string | null;
    modulos: unknown;
    totales: unknown;
  }): Promise<{ id: string }> {
    return this.run(async (c) => {
      const r = await c.query(
        `INSERT INTO qa_center.erp_discoveries
           (project_id, run_id, commit_sha, codebase, modulos, totales)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
         RETURNING id`,
        [
          input.project_id,
          input.run_id,
          input.commit_sha,
          input.codebase,
          JSON.stringify(input.modulos ?? []),
          JSON.stringify(input.totales ?? {}),
        ]
      );
      return { id: r.rows[0].id as string };
    });
  }

  async latestErpDiscovery(projectId: string): Promise<{
    id: string;
    run_id: string | null;
    codebase: string | null;
    modulos: unknown;
    totales: unknown;
    created_at: string;
  } | null> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT id, run_id, codebase, modulos, totales, created_at
           FROM qa_center.erp_discoveries
          WHERE project_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [projectId]
      );
      if (r.rowCount === 0) return null;
      const row = r.rows[0] as Record<string, unknown>;
      return {
        id: row.id as string,
        run_id: (row.run_id as string) ?? null,
        codebase: (row.codebase as string) ?? null,
        modulos: row.modulos,
        totales: row.totales,
        created_at: (row.created_at as Date).toISOString(),
      };
    });
  }

  async insertAiUsage(input: {
    run_id: string;
    step: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    cost_usd: number;
    status: "ok" | "skipped_budget" | "error";
    error_message: string | null;
  }): Promise<void> {
    await this.run(async (c) => {
      await c.query(
        `INSERT INTO qa_center.ai_usage
           (run_id, step, model, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, cost_usd, status, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.run_id,
          input.step,
          input.model,
          input.input_tokens | 0,
          input.output_tokens | 0,
          input.cache_read_tokens | 0,
          input.cache_creation_tokens | 0,
          input.cost_usd,
          input.status,
          input.error_message,
        ]
      );
    });
  }

  async sumAiCostForRun(runId: string): Promise<number> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT COALESCE(SUM(cost_usd), 0)::text AS total
           FROM qa_center.ai_usage WHERE run_id = $1`,
        [runId]
      );
      return Number(r.rows[0]?.total ?? "0");
    });
  }

  async upsertGeneratedSpecs(input: {
    codebase: string;
    created_by_run_id: string;
    specs: Array<{
      modulo: string;
      spec_file: string;
      spec_source: string;
      source_sanitized_sha256: string;
      invariante: string;
      severidad: string;
      requiere_sesion: boolean;
    }>;
  }): Promise<{ inserted: number; updated: number }> {
    if (input.specs.length === 0) return { inserted: 0, updated: 0 };
    return this.run(async (c) => {
      let ins = 0;
      let upd = 0;
      for (const s of input.specs) {
        const r = await c.query(
          `INSERT INTO qa_center.generated_specs
             (codebase, modulo, spec_file, spec_source, source_sanitized_sha256,
              invariante, severidad, requiere_sesion, created_by_run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (codebase, spec_file) DO UPDATE SET
             spec_source = EXCLUDED.spec_source,
             source_sanitized_sha256 = EXCLUDED.source_sanitized_sha256,
             invariante = EXCLUDED.invariante,
             severidad = EXCLUDED.severidad,
             requiere_sesion = EXCLUDED.requiere_sesion,
             status = 'validated',
             updated_at = now()
           RETURNING xmax = 0 AS inserted`,
          [
            input.codebase,
            s.modulo,
            s.spec_file,
            s.spec_source,
            s.source_sanitized_sha256,
            s.invariante,
            s.severidad,
            s.requiere_sesion,
            input.created_by_run_id,
          ]
        );
        if (r.rows[0]?.inserted) ins += 1; else upd += 1;
      }
      return { inserted: ins, updated: upd };
    }, /* tx */ true);
  }

  /**
   * Inserta uno o varios eventos de progreso en vivo del agente QA.
   * El runner los emite spec-por-spec; la UI del run los pinta en timeline.
   */
  async insertRunEvents(events: Array<{
    run_id: string;
    fase: string;
    modulo: string | null;
    submodulo: string | null;
    accion: string | null;
    estado: string;
    mensaje: string | null;
    evidence_path: string | null;
    payload: Record<string, unknown> | null;
  }>): Promise<void> {
    if (events.length === 0) return;
    await this.run(async (c) => {
      // Insert batch con UNNEST para una sola roundtrip.
      const run_ids   = events.map((e) => e.run_id);
      const fases     = events.map((e) => e.fase);
      const modulos   = events.map((e) => e.modulo);
      const submods   = events.map((e) => e.submodulo);
      const acciones  = events.map((e) => e.accion);
      const estados   = events.map((e) => e.estado);
      const mensajes  = events.map((e) => e.mensaje);
      const evidences = events.map((e) => e.evidence_path);
      const payloads  = events.map((e) => (e.payload !== null ? JSON.stringify(e.payload) : null));
      await c.query(
        `INSERT INTO qa_center.run_events
           (run_id, fase, modulo, submodulo, accion, estado, mensaje, evidence_path, payload)
         SELECT * FROM UNNEST(
           $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[],
           $6::text[], $7::text[], $8::text[], $9::jsonb[]
         )`,
        [run_ids, fases, modulos, submods, acciones, estados, mensajes, evidences, payloads]
      );
    });
  }

  /**
   * Lista eventos del run (asc), opcionalmente desde un timestamp hacia adelante.
   * Usado por el polling del timeline en la UI.
   */
  async listRunEvents(
    run_id: string,
    opts: { since: Date | null; limit: number }
  ): Promise<Array<{
    id: string;
    ts: string;
    fase: string;
    modulo: string | null;
    submodulo: string | null;
    accion: string | null;
    estado: string;
    mensaje: string | null;
    evidence_path: string | null;
    payload: Record<string, unknown> | null;
  }>> {
    return this.run(async (c) => {
      const args: unknown[] = [run_id];
      let where = "run_id = $1";
      if (opts.since) {
        args.push(opts.since.toISOString());
        where += ` AND ts > $${args.length}`;
      }
      args.push(opts.limit);
      const limitIdx = args.length;
      const r = await c.query(
        `SELECT id, ts, fase, modulo, submodulo, accion, estado, mensaje, evidence_path, payload
           FROM qa_center.run_events
          WHERE ${where}
          ORDER BY ts ASC, id ASC
          LIMIT $${limitIdx}`,
        args
      );
      return r.rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
        fase: String(row.fase),
        modulo: row.modulo === null ? null : String(row.modulo),
        submodulo: row.submodulo === null ? null : String(row.submodulo),
        accion: row.accion === null ? null : String(row.accion),
        estado: String(row.estado),
        mensaje: row.mensaje === null ? null : String(row.mensaje),
        evidence_path: row.evidence_path === null ? null : String(row.evidence_path),
        payload: row.payload === null ? null : (row.payload as Record<string, unknown>),
      }));
    });
  }

  async upsertInformeIa(input: {
    run_id: string;
    project_id: string;
    resumen: string;
    modulos: unknown;
  }): Promise<void> {
    await this.run(async (c) => {
      await c.query(
        `INSERT INTO qa_center.informes_ia (run_id, project_id, resumen, modulos)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (run_id) DO UPDATE SET
           resumen = EXCLUDED.resumen,
           modulos = EXCLUDED.modulos`,
        [input.run_id, input.project_id, input.resumen, JSON.stringify(input.modulos ?? [])]
      );
    });
  }

  async listGeneratedSpecsForCodebase(codebase: string): Promise<Array<{
    id: string;
    codebase: string;
    modulo: string;
    spec_file: string;
    spec_source: string;
    source_sanitized_sha256: string;
    invariante: string;
    severidad: string;
    requiere_sesion: boolean;
    estado_ejecucion: string;
  }>> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT id, codebase, modulo, spec_file, spec_source, source_sanitized_sha256,
                invariante, severidad, requiere_sesion, estado_ejecucion
           FROM qa_center.generated_specs
          WHERE codebase = $1
            AND status = 'validated'
            AND estado_ejecucion <> 'blocked_safety'
          ORDER BY modulo, spec_file`,
        [codebase]
      );
      return r.rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        codebase: String(row.codebase),
        modulo: String(row.modulo),
        spec_file: String(row.spec_file),
        spec_source: String(row.spec_source),
        source_sanitized_sha256: String(row.source_sanitized_sha256),
        invariante: String(row.invariante),
        severidad: String(row.severidad),
        requiere_sesion: Boolean(row.requiere_sesion),
        estado_ejecucion: String(row.estado_ejecucion),
      }));
    });
  }

  async updateGeneratedSpecEstado(input: {
    codebase: string;
    spec_file: string;
    estado: "pending" | "executed_pass" | "executed_fail" | "executed_error" | "blocked_env_assert" | "blocked_safety";
    run_id: string | null;
    error_message?: string | null;
  }): Promise<void> {
    await this.run(async (c) => {
      await c.query(
        `UPDATE qa_center.generated_specs
            SET estado_ejecucion = $3,
                last_run_id = $4,
                last_executed_at = now(),
                last_error = $5,
                updated_at = now()
          WHERE codebase = $1 AND spec_file = $2`,
        [input.codebase, input.spec_file, input.estado, input.run_id, input.error_message ?? null]
      );
    });
  }

  async coberturaPorModuloParaCodebase(codebase: string): Promise<Array<{
    modulo: string;
    pending: number;
    executed_pass: number;
    executed_fail: number;
    executed_error: number;
    blocked_env_assert: number;
    blocked_safety: number;
  }>> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT modulo,
                SUM((estado_ejecucion='pending')::int)            AS pending,
                SUM((estado_ejecucion='executed_pass')::int)      AS executed_pass,
                SUM((estado_ejecucion='executed_fail')::int)      AS executed_fail,
                SUM((estado_ejecucion='executed_error')::int)     AS executed_error,
                SUM((estado_ejecucion='blocked_env_assert')::int) AS blocked_env_assert,
                SUM((estado_ejecucion='blocked_safety')::int)     AS blocked_safety
           FROM qa_center.generated_specs
          WHERE codebase = $1
          GROUP BY modulo
          ORDER BY modulo`,
        [codebase]
      );
      return r.rows.map((row: Record<string, unknown>) => ({
        modulo: String(row.modulo),
        pending: Number(row.pending ?? 0),
        executed_pass: Number(row.executed_pass ?? 0),
        executed_fail: Number(row.executed_fail ?? 0),
        executed_error: Number(row.executed_error ?? 0),
        blocked_env_assert: Number(row.blocked_env_assert ?? 0),
        blocked_safety: Number(row.blocked_safety ?? 0),
      }));
    });
  }

  async latestInformeIa(projectId: string): Promise<{
    run_id: string;
    resumen: string;
    modulos: unknown;
    created_at: string;
  } | null> {
    return this.run(async (c) => {
      const r = await c.query(
        `SELECT run_id, resumen, modulos, created_at
           FROM qa_center.informes_ia
          WHERE project_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [projectId]
      );
      if (r.rowCount === 0) return null;
      const row = r.rows[0] as Record<string, unknown>;
      return {
        run_id: row.run_id as string,
        resumen: row.resumen as string,
        modulos: row.modulos,
        created_at: (row.created_at as Date).toISOString(),
      };
    });
  }
}
