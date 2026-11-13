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
  estado_entrega: "en_desarrollo" | "en_qa" | "entregado";
  autorizacion_qa_hasta: string | null;
  repo_url?: string | null;
  /**
   * El admin certificó que el ERP tiene usuario QA de sólo lectura y autoriza
   * correr suites "authenticated_read_only" aunque no exista env-assert
   * runtime. NUNCA aplica a suites con escritura o lectura no estricta.
   */
  permite_lectura_sin_env_assert?: boolean;
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

  /** Proyectos NO archivados, orden descendente por created_at. */
  listActiveProjects(limit?: number): Promise<QaProject[]>;
  /** Suites de un proyecto, orden descendente por created_at. */
  listSuitesForProject(projectId: string): Promise<QaSuite[]>;

  // ── CRUD administración (gated server-side, nunca por el runner) ──

  /** Crea un proyecto. El slug debe ser único; devuelve null si colisiona. */
  createProject(input: {
    slug: string;
    name: string;
    target_base_url: string;
    target_env: QaTargetEnv;
    default_branch?: string;
    owner_user_id?: string | null;
  }): Promise<QaProject | { conflict: "slug" }>;

  /** Actualiza campos editables de un proyecto. No cambia el slug. */
  updateProject(
    projectId: string,
    patch: Partial<Pick<QaProject, "name" | "target_base_url" | "target_env" | "default_branch">>
  ): Promise<QaProject | null>;

  /** Crea un suite. Duplicados por (project_id, slug) → conflict. */
  createSuite(input: {
    project_id: string;
    slug: string;
    name: string;
    description?: string | null;
    tags?: string[];
    specs: string[];
    enabled?: boolean;
  }): Promise<QaSuite | { conflict: "slug" } | { conflict: "project_not_found" }>;

  /** Actualiza campos editables de un suite. */
  updateSuite(
    suiteId: string,
    patch: Partial<Pick<QaSuite, "name" | "tags" | "specs" | "enabled">>
  ): Promise<QaSuite | null>;

  /** Resultados de un run (orden estable por test_title). */
  listResultsForRun(runId: string): Promise<ResultPayload[]>;

  /** Hallazgos (findings) — lista para el panel. Por proyecto si se provee. */
  listFindings(opts?: { projectId?: string; limit?: number }): Promise<QaFindingRow[]>;

  // ── Ciclo de vida: autorizar / entregar ───────────────────────────────

  /**
   * Registra una autorización firmada y pasa el proyecto a `en_qa`
   * con `autorizacion_qa_hasta=hasta`. Deja fila en project_autorizaciones.
   */
  autorizarProyecto(input: {
    project_id: string;
    usuario_id: string | null;
    declaraciones: Record<string, boolean>;
    autorizado_hasta: string;
  }): Promise<QaProject | null>;

  /**
   * Marca un proyecto como `entregado`. Bloqueo total (no se pueden
   * encolar ni ejecutar runs mientras esté en ese estado).
   */
  entregarProyecto(input: { project_id: string; usuario_id: string | null }): Promise<QaProject | null>;

  /**
   * Inserta un lote de findings (una fila por hallazgo). Reusable para la
   * auditoría estática: el runner emite findings tras clonar el repo.
   * `description` completa debe incluir file:line y evidencia; el handler
   * las compone a partir del payload.
   */
  insertFindings(input: {
    run_id: string;
    project_id: string;
    findings: Array<{
      title: string;
      description: string;
      severity: QaFindingSeverity;
      funcion_revisada?: string | null;
      resultado_esperado?: string | null;
      resultado_obtenido?: string | null;
      recomendacion?: string | null;
      evidencia_url?: string | null;
      modulo_negocio?: string | null;
    }>;
  }): Promise<{ inserted: number }>;

  /**
   * Admin-only: alterna el flag `permite_lectura_sin_env_assert` del proyecto.
   * El caller debe haber verificado el rol admin antes de llamar.
   */
  setPermiteLecturaSinEnvAssert(input: {
    project_id: string;
    valor: boolean;
    actor_id: string | null;
  }): Promise<QaProject | null>;

  // ── Analizar ERP (pipeline IA) ──────────────────────────────────────────

  /** Persiste el output del discovery del runner. */
  insertErpDiscovery(input: {
    project_id: string;
    run_id: string;
    commit_sha: string | null;
    codebase: string | null;
    modulos: unknown;
    totales: unknown;
  }): Promise<{ id: string }>;

  /** Último discovery del proyecto (para mostrar en el panel). */
  latestErpDiscovery(projectId: string): Promise<{
    id: string;
    run_id: string | null;
    codebase: string | null;
    modulos: unknown;
    totales: unknown;
    created_at: string;
  } | null>;

  /** Inserta uso de API de LLM para control de costos. */
  insertAiUsage(input: {
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
  }): Promise<void>;

  /** Suma del costo USD por run para mostrar en el panel. */
  sumAiCostForRun(runId: string): Promise<number>;

  /** Persiste specs generados por IA + sanitizados para reuso cross-ERP. */
  upsertGeneratedSpecs(input: {
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
  }): Promise<{ inserted: number; updated: number }>;

  /** Guarda el informe humano del run. */
  upsertInformeIa(input: {
    run_id: string;
    project_id: string;
    resumen: string;
    modulos: unknown;
  }): Promise<void>;

  latestInformeIa(projectId: string): Promise<{
    run_id: string;
    resumen: string;
    modulos: unknown;
    created_at: string;
  } | null>;
}

export type QaFindingSeverity = "blocker" | "critical" | "major" | "minor" | "info";
export type QaFindingStatus = "open" | "triaged" | "confirmed" | "wont_fix" | "fixed" | "closed";

export type QaFindingRow = {
  id: string;
  project_id: string;
  run_id: string | null;
  result_id: string | null;
  title: string;
  description: string | null;
  severity: QaFindingSeverity;
  status: QaFindingStatus;
  triage_notes: string | null;
  external_ticket_ref: string | null;
  created_at: string;
  updated_at: string;
};
