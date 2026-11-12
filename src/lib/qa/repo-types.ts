/**
 * Interfaz del repositorio de qa_center.
 * Dos implementaciones:
 *   - Supabase (prod/staging, requiere aplicar la migración + exponer schema).
 *   - En memoria (tests locales; sin DB, sin red).
 */

export type QaRunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "aborted"
  | "error";

export type QaTargetEnv = "staging" | "preview" | "local";

export type QaProject = {
  id: string;
  slug: string;
  name: string;
  target_base_url: string;
  target_env: QaTargetEnv;
  default_branch: string;
};

export type QaSuite = {
  id: string;
  project_id: string;
  slug: string;
  name: string;
  tags: string[];
  enabled: boolean;
  specs: string[]; // whitelist de specs autorizados por este suite
};

export type QaRun = {
  id: string;
  project_id: string;
  suite_id: string;
  status: QaRunStatus;
  trigger: string;
  target_base_url: string;
  target_env: QaTargetEnv;
  triggered_by_user_id: string | null;
  triggered_by_ref: string | null;
  totals: { passed: number; failed: number; skipped: number; flaky: number };
  env_assert_passed: boolean | null;
  env_assert_response: unknown | null;
  summary: string | null;
  duration_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type QaRunnerJob = {
  id: string;
  run_id: string;
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  max_attempts: number;
  heartbeat_at: string | null;
  created_at: string;
};

export type ResultPayload = {
  spec_file: string;
  test_title: string;
  status: "passed" | "failed" | "skipped" | "flaky" | "timed_out";
  duration_ms: number | null;
  retries: number;
  error_type: string | null;
  error_message: string | null;
  stack_trace: string | null;
};

export type FinishRunInput = {
  status: Exclude<QaRunStatus, "queued" | "running">;
  totals: QaRun["totals"];
  summary: string;
  duration_ms: number;
  env_assert_passed: boolean;
  env_assert_response: unknown | null;
};

export type ClaimedJob = {
  job: QaRunnerJob;
  run: QaRun;
  project: QaProject;
  suite: QaSuite;
};

export interface QaRunsRepo {
  getProject(projectId: string): Promise<QaProject | null>;
  getSuite(suiteId: string): Promise<QaSuite | null>;

  /**
   * Crea un run + runner_job atómicamente.
   * `clientRequestId` permite idempotencia: si ya existe un run con ese ref
   * en los últimos 10 min, devuelve el run existente en lugar de duplicar.
   */
  createRunAndJob(input: {
    project: QaProject;
    suite: QaSuite;
    triggered_by_user_id: string | null;
    clientRequestId: string | null;
  }): Promise<{ run: QaRun; job: QaRunnerJob; created: boolean }>;

  /**
   * Claim atómico: el primer runner que llame se lleva el próximo job unclaimed.
   * Los demás ven null. El run asociado pasa a `running`.
   */
  claimNextJob(workerId: string): Promise<ClaimedJob | null>;

  heartbeat(runId: string, workerId: string): Promise<void>;

  /**
   * Inserta un result. Idempotente por (run_id, spec_file, test_title).
   * Si ya existe uno, se ignora el nuevo (primera escritura gana).
   */
  insertResultIdempotent(runId: string, result: ResultPayload): Promise<"inserted" | "skipped">;

  /**
   * Finaliza un run. Idempotente: si el run ya está finalizado, no lo pisa.
   * Solo el worker que claimó puede finalizar.
   */
  finishRunIdempotent(
    runId: string,
    workerId: string,
    input: FinishRunInput
  ): Promise<"finished" | "already_finished" | "not_owner">;

  listRecentRuns(limit: number): Promise<QaRun[]>;
  getRun(runId: string): Promise<QaRun | null>;
}
