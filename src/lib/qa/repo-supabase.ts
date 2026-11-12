/**
 * Implementación Supabase del QaRunsRepo.
 *
 * ⚠️ Esta implementación compila y fue tipada pero NO está verificada en
 * runtime hasta que:
 *   1. La migración `20261112000000_qa_center_schema.sql` se aplique al
 *      Supabase self-hosted.
 *   2. El esquema `qa_center` se exponga en `supabase/config.toml :: [api].schemas`.
 *
 * Mientras tanto los tests usan `InMemoryQaRunsRepo`.
 */

import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type {
  ClaimedJob,
  FinishRunInput,
  QaProject,
  QaRun,
  QaRunnerJob,
  QaRunsRepo,
  QaSuite,
  ResultPayload,
} from "./repo-types";

export class SupabaseQaRunsRepo implements QaRunsRepo {
  constructor(private readonly client: AppSupabaseClient) {}

  private qc() {
    return this.client.schema("qa_center");
  }

  async getProject(projectId: string): Promise<QaProject | null> {
    const { data } = await this.qc()
      .from("projects")
      .select("id, slug, name, target_base_url, target_env, default_branch")
      .eq("id", projectId)
      .is("archived_at", null)
      .maybeSingle();
    return (data as QaProject | null) ?? null;
  }

  async getSuite(suiteId: string): Promise<QaSuite | null> {
    const { data } = await this.qc()
      .from("suites")
      .select("id, project_id, slug, name, tags, specs, enabled")
      .eq("id", suiteId)
      .maybeSingle();
    if (!data) return null;
    const row = data as QaSuite & { specs: string[] | null };
    return { ...row, specs: row.specs ?? [] };
  }

  async createRunAndJob(input: {
    project: QaProject;
    suite: QaSuite;
    triggered_by_user_id: string | null;
    clientRequestId: string | null;
  }): Promise<{ run: QaRun; job: QaRunnerJob; created: boolean }> {
    // Idempotencia: si existe un run reciente con el mismo triggered_by_ref,
    // devolver ese en lugar de crear uno nuevo.
    if (input.clientRequestId) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: existing } = await this.qc()
        .from("runs")
        .select("*")
        .eq("project_id", input.project.id)
        .eq("suite_id", input.suite.id)
        .eq("triggered_by_ref", input.clientRequestId)
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();
      if (existing) {
        const { data: job } = await this.qc()
          .from("runner_jobs")
          .select("*")
          .eq("run_id", (existing as QaRun).id)
          .maybeSingle();
        if (job) return { run: existing as QaRun, job: job as QaRunnerJob, created: false };
      }
    }

    const { data: run, error: runErr } = await this.qc()
      .from("runs")
      .insert({
        project_id: input.project.id,
        suite_id: input.suite.id,
        status: "queued",
        trigger: "manual",
        target_base_url: input.project.target_base_url,
        target_env: input.project.target_env,
        triggered_by_user_id: input.triggered_by_user_id,
        triggered_by_ref: input.clientRequestId,
      })
      .select("*")
      .single();
    if (runErr || !run) throw new Error(`createRun: ${runErr?.message ?? "sin fila"}`);

    const { data: job, error: jobErr } = await this.qc()
      .from("runner_jobs")
      .insert({ run_id: (run as QaRun).id })
      .select("*")
      .single();
    if (jobErr || !job) throw new Error(`createJob: ${jobErr?.message ?? "sin fila"}`);
    return { run: run as QaRun, job: job as QaRunnerJob, created: true };
  }

  async claimNextJob(workerId: string): Promise<ClaimedJob | null> {
    const { data, error } = await this.qc().rpc("claim_next_job", { p_worker: workerId });
    if (error) throw new Error(`claimNextJob: ${error.message}`);
    const job = data as QaRunnerJob | null;
    if (!job) return null;
    const { data: run } = await this.qc()
      .from("runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.run_id)
      .select("*")
      .single();
    if (!run) return null;
    const project = await this.getProject((run as QaRun).project_id);
    const suite = await this.getSuite((run as QaRun).suite_id);
    if (!project || !suite) return null;
    return { job, run: run as QaRun, project, suite };
  }

  async heartbeat(runId: string, workerId: string): Promise<void> {
    await this.qc()
      .from("runner_jobs")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("run_id", runId)
      .eq("claimed_by", workerId);
  }

  async insertResultIdempotent(
    runId: string,
    result: ResultPayload
  ): Promise<"inserted" | "skipped"> {
    // Idempotencia enforceada por UNIQUE (run_id, spec_file, test_title).
    // `onConflict` + `ignoreDuplicates: true` deja a Postgres resolver la carrera.
    const { data, error } = await this.qc()
      .from("results")
      .upsert(
        { run_id: runId, ...result },
        { onConflict: "run_id,spec_file,test_title", ignoreDuplicates: true }
      )
      .select("id");
    if (error) throw new Error(`insertResult: ${error.message}`);
    return data && data.length > 0 ? "inserted" : "skipped";
  }

  async finishRunIdempotent(
    runId: string,
    workerId: string,
    input: FinishRunInput
  ): Promise<"finished" | "already_finished" | "not_owner"> {
    const { data: job } = await this.qc()
      .from("runner_jobs")
      .select("claimed_by")
      .eq("run_id", runId)
      .maybeSingle();
    const claimedBy = (job as { claimed_by: string | null } | null)?.claimed_by ?? null;
    if (claimedBy !== null && claimedBy !== workerId) {
      return "not_owner";
    }
    // UPDATE condicional atómico: solo actualiza si finished_at IS NULL.
    // Si el run ya estaba finalizado o pertenece a otro worker, no modifica.
    const { data, error } = await this.qc()
      .from("runs")
      .update({
        status: input.status,
        totals: input.totals,
        summary: input.summary,
        duration_ms: input.duration_ms,
        env_assert_passed: input.env_assert_passed,
        env_assert_response: input.env_assert_response,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .is("finished_at", null)
      .select("id");
    if (error) throw new Error(`finishRun: ${error.message}`);
    return data && data.length > 0 ? "finished" : "already_finished";
  }

  async listRecentRuns(limit: number): Promise<QaRun[]> {
    const { data } = await this.qc()
      .from("runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as QaRun[] | null) ?? [];
  }

  async getRun(runId: string): Promise<QaRun | null> {
    const { data } = await this.qc()
      .from("runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    return (data as QaRun | null) ?? null;
  }

  async listActiveProjects(limit = 100): Promise<QaProject[]> {
    const { data } = await this.qc()
      .from("projects")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as QaProject[] | null) ?? [];
  }

  async listSuitesForProject(projectId: string): Promise<QaSuite[]> {
    const { data } = await this.qc()
      .from("suites")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    return (data as QaSuite[] | null) ?? [];
  }
}
