/**
 * Implementación en memoria del QaRunsRepo.
 * Uso exclusivo: tests locales. No persiste. No es thread-safe para múltiples
 * procesos; sí es seguro dentro de un solo proceso Node (Mutex sincrónico).
 */

import { randomUUID } from "node:crypto";
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

type State = {
  projects: Map<string, QaProject>;
  suites: Map<string, QaSuite>;
  runs: Map<string, QaRun>;
  jobs: Map<string, QaRunnerJob>;
  results: Map<string, ResultPayload>; // key = run_id::spec_file::test_title
  recentIdempotency: Map<string, { runId: string; at: number }>; // clientRequestId → runId
};

export class InMemoryQaRunsRepo implements QaRunsRepo {
  readonly state: State = {
    projects: new Map(),
    suites: new Map(),
    runs: new Map(),
    jobs: new Map(),
    results: new Map(),
    recentIdempotency: new Map(),
  };

  seedProject(p: QaProject): void {
    this.state.projects.set(p.id, p);
  }
  seedSuite(s: QaSuite): void {
    this.state.suites.set(s.id, s);
  }

  async getProject(id: string): Promise<QaProject | null> {
    return this.state.projects.get(id) ?? null;
  }
  async getSuite(id: string): Promise<QaSuite | null> {
    return this.state.suites.get(id) ?? null;
  }

  async createRunAndJob(input: {
    project: QaProject;
    suite: QaSuite;
    triggered_by_user_id: string | null;
    clientRequestId: string | null;
  }): Promise<{ run: QaRun; job: QaRunnerJob; created: boolean }> {
    if (input.clientRequestId) {
      const now = Date.now();
      const existing = this.state.recentIdempotency.get(input.clientRequestId);
      if (existing && now - existing.at < 10 * 60 * 1000) {
        const run = this.state.runs.get(existing.runId);
        const job = [...this.state.jobs.values()].find((j) => j.run_id === existing.runId);
        if (run && job) return { run, job, created: false };
      }
    }

    const runId = randomUUID();
    const nowIso = new Date().toISOString();
    const run: QaRun = {
      id: runId,
      project_id: input.project.id,
      suite_id: input.suite.id,
      status: "queued",
      trigger: "manual",
      target_base_url: input.project.target_base_url,
      target_env: input.project.target_env,
      triggered_by_user_id: input.triggered_by_user_id,
      triggered_by_ref: input.clientRequestId,
      totals: { passed: 0, failed: 0, skipped: 0, flaky: 0 },
      env_assert_passed: null,
      env_assert_response: null,
      summary: null,
      duration_ms: null,
      started_at: null,
      finished_at: null,
      created_at: nowIso,
    };
    const job: QaRunnerJob = {
      id: randomUUID(),
      run_id: runId,
      claimed_by: null,
      claimed_at: null,
      attempts: 0,
      max_attempts: 3,
      heartbeat_at: null,
      created_at: nowIso,
    };
    this.state.runs.set(run.id, run);
    this.state.jobs.set(job.id, job);
    if (input.clientRequestId) {
      this.state.recentIdempotency.set(input.clientRequestId, { runId, at: Date.now() });
    }
    return { run, job, created: true };
  }

  async claimNextJob(workerId: string): Promise<ClaimedJob | null> {
    const unclaimed = [...this.state.jobs.values()]
      .filter((j) => j.claimed_at === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const job = unclaimed[0];
    if (!job) return null;
    const nowIso = new Date().toISOString();
    job.claimed_by = workerId;
    job.claimed_at = nowIso;
    job.heartbeat_at = nowIso;
    job.attempts += 1;
    const run = this.state.runs.get(job.run_id);
    if (!run) return null;
    run.status = "running";
    run.started_at = nowIso;
    const project = this.state.projects.get(run.project_id);
    const suite = this.state.suites.get(run.suite_id);
    if (!project || !suite) return null;
    return { job, run, project, suite };
  }

  async heartbeat(runId: string, workerId: string): Promise<void> {
    const job = [...this.state.jobs.values()].find((j) => j.run_id === runId);
    if (!job || job.claimed_by !== workerId) return;
    job.heartbeat_at = new Date().toISOString();
  }

  async insertResultIdempotent(
    runId: string,
    result: ResultPayload
  ): Promise<"inserted" | "skipped"> {
    const key = `${runId}::${result.spec_file}::${result.test_title}`;
    if (this.state.results.has(key)) return "skipped";
    this.state.results.set(key, result);
    return "inserted";
  }

  async finishRunIdempotent(
    runId: string,
    workerId: string,
    input: FinishRunInput
  ): Promise<"finished" | "already_finished" | "not_owner"> {
    const run = this.state.runs.get(runId);
    if (!run) return "already_finished";
    const job = [...this.state.jobs.values()].find((j) => j.run_id === runId);
    if (job && job.claimed_by !== workerId) return "not_owner";
    if (run.finished_at) return "already_finished";
    const nowIso = new Date().toISOString();
    run.status = input.status;
    run.totals = input.totals;
    run.summary = input.summary;
    run.duration_ms = input.duration_ms;
    run.env_assert_passed = input.env_assert_passed;
    run.env_assert_response = input.env_assert_response;
    run.finished_at = nowIso;
    return "finished";
  }

  async listRecentRuns(limit: number): Promise<QaRun[]> {
    return [...this.state.runs.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  async getRun(runId: string): Promise<QaRun | null> {
    return this.state.runs.get(runId) ?? null;
  }
  async listActiveProjects(limit = 100): Promise<QaProject[]> {
    return [...this.state.projects.values()].slice(0, limit);
  }
  async listSuitesForProject(projectId: string): Promise<QaSuite[]> {
    return [...this.state.suites.values()].filter((s) => s.project_id === projectId);
  }

  // ─── CRUD administración: stubs para que compile. Esta impl in-memory
  // existe sólo para tests del handler y no se usa en runtime. Si algún test
  // lo necesita, se implementa ahí sin cambiar la interfaz. ───
  async createProject(_input: Parameters<QaRunsRepo["createProject"]>[0]): ReturnType<QaRunsRepo["createProject"]> {
    throw new Error("InMemoryQaRunsRepo.createProject no implementado — usar PostgresQaRunsRepo");
  }
  async updateProject(
    _projectId: string,
    _patch: Parameters<QaRunsRepo["updateProject"]>[1]
  ): ReturnType<QaRunsRepo["updateProject"]> {
    throw new Error("InMemoryQaRunsRepo.updateProject no implementado — usar PostgresQaRunsRepo");
  }
  async createSuite(_input: Parameters<QaRunsRepo["createSuite"]>[0]): ReturnType<QaRunsRepo["createSuite"]> {
    throw new Error("InMemoryQaRunsRepo.createSuite no implementado — usar PostgresQaRunsRepo");
  }
  async updateSuite(
    _suiteId: string,
    _patch: Parameters<QaRunsRepo["updateSuite"]>[1]
  ): ReturnType<QaRunsRepo["updateSuite"]> {
    throw new Error("InMemoryQaRunsRepo.updateSuite no implementado — usar PostgresQaRunsRepo");
  }
  async listResultsForRun(runId: string): Promise<ResultPayload[]> {
    return [...this.state.results.entries()]
      .filter(([k]) => k.startsWith(`${runId}::`))
      .map(([, v]) => v);
  }
  async listFindings(_opts: { projectId?: string; limit?: number } = {}): Promise<QaFindingRow[]> {
    return [];
  }
  async autorizarProyecto(_input: Parameters<QaRunsRepo["autorizarProyecto"]>[0]): ReturnType<QaRunsRepo["autorizarProyecto"]> {
    throw new Error("InMemoryQaRunsRepo.autorizarProyecto no implementado — usar PostgresQaRunsRepo");
  }
  async entregarProyecto(_input: Parameters<QaRunsRepo["entregarProyecto"]>[0]): ReturnType<QaRunsRepo["entregarProyecto"]> {
    throw new Error("InMemoryQaRunsRepo.entregarProyecto no implementado — usar PostgresQaRunsRepo");
  }

  readonly insertedFindings: Array<{
    run_id: string;
    project_id: string;
    title: string;
    description: string;
    severity: "blocker" | "critical" | "major" | "minor" | "info";
    funcion_revisada?: string | null;
    resultado_esperado?: string | null;
    resultado_obtenido?: string | null;
    recomendacion?: string | null;
    evidencia_url?: string | null;
    modulo_negocio?: string | null;
  }> = [];

  async insertFindings(input: Parameters<QaRunsRepo["insertFindings"]>[0]): ReturnType<QaRunsRepo["insertFindings"]> {
    for (const f of input.findings) {
      this.insertedFindings.push({
        run_id: input.run_id,
        project_id: input.project_id,
        title: f.title,
        description: f.description,
        severity: f.severity,
        funcion_revisada: f.funcion_revisada ?? null,
        resultado_esperado: f.resultado_esperado ?? null,
        resultado_obtenido: f.resultado_obtenido ?? null,
        recomendacion: f.recomendacion ?? null,
        evidencia_url: f.evidencia_url ?? null,
        modulo_negocio: f.modulo_negocio ?? null,
      });
    }
    return { inserted: input.findings.length };
  }

  async setPermiteLecturaSinEnvAssert(input: Parameters<QaRunsRepo["setPermiteLecturaSinEnvAssert"]>[0]): ReturnType<QaRunsRepo["setPermiteLecturaSinEnvAssert"]> {
    // Busca el proyecto en el mapa in-memory y actualiza el flag.
    const p = (this as unknown as { projects: Map<string, QaProject> }).projects?.get?.(input.project_id);
    if (!p) return null;
    const next: QaProject = { ...p, permite_lectura_sin_env_assert: input.valor };
    (this as unknown as { projects: Map<string, QaProject> }).projects?.set?.(input.project_id, next);
    return next;
  }

  // ── Pipeline IA ───────────────────────────────────────────────────────
  insertedDiscoveries: Array<{ project_id: string; run_id: string; modulos: unknown; totales: unknown }> = [];
  insertedUsage: Array<{ run_id: string; step: string; cost_usd: number; status: string }> = [];
  insertedGeneratedSpecs: Array<{ codebase: string; spec_file: string; invariante: string }> = [];
  insertedInformes: Array<{ run_id: string; resumen: string }> = [];

  async insertErpDiscovery(input: Parameters<QaRunsRepo["insertErpDiscovery"]>[0]): Promise<{ id: string }> {
    this.insertedDiscoveries.push({ project_id: input.project_id, run_id: input.run_id, modulos: input.modulos, totales: input.totales });
    return { id: `discov-${this.insertedDiscoveries.length}` };
  }
  async latestErpDiscovery(projectId: string): Promise<{
    id: string; run_id: string | null; codebase: string | null; modulos: unknown; totales: unknown; created_at: string;
  } | null> {
    const found = [...this.insertedDiscoveries].reverse().find((d) => d.project_id === projectId);
    if (!found) return null;
    return { id: "mem", run_id: found.run_id, codebase: null, modulos: found.modulos, totales: found.totales, created_at: new Date().toISOString() };
  }
  async insertAiUsage(input: Parameters<QaRunsRepo["insertAiUsage"]>[0]): Promise<void> {
    this.insertedUsage.push({ run_id: input.run_id, step: input.step, cost_usd: input.cost_usd, status: input.status });
  }
  async sumAiCostForRun(runId: string): Promise<number> {
    return this.insertedUsage.filter((u) => u.run_id === runId).reduce((n, u) => n + u.cost_usd, 0);
  }
  async upsertGeneratedSpecs(input: Parameters<QaRunsRepo["upsertGeneratedSpecs"]>[0]): Promise<{ inserted: number; updated: number }> {
    let ins = 0, upd = 0;
    for (const s of input.specs) {
      const existing = this.insertedGeneratedSpecs.find((x) => x.codebase === input.codebase && x.spec_file === s.spec_file);
      if (existing) upd += 1;
      else { this.insertedGeneratedSpecs.push({ codebase: input.codebase, spec_file: s.spec_file, invariante: s.invariante }); ins += 1; }
    }
    return { inserted: ins, updated: upd };
  }
  async upsertInformeIa(input: Parameters<QaRunsRepo["upsertInformeIa"]>[0]): Promise<void> {
    this.insertedInformes.push({ run_id: input.run_id, resumen: input.resumen });
  }
  async latestInformeIa(_projectId: string): Promise<{ run_id: string; resumen: string; modulos: unknown; created_at: string } | null> {
    if (this.insertedInformes.length === 0) return null;
    const last = this.insertedInformes[this.insertedInformes.length - 1];
    return { run_id: last.run_id, resumen: last.resumen, modulos: [], created_at: new Date().toISOString() };
  }
}
