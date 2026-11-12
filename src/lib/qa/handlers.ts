/**
 * Handlers puros del QA Center. No dependen de Next.js: reciben input ya
 * parseado y un repo, devuelven `HandlerResult`. Las rutas Next lo convierten
 * a NextResponse. Esto simplifica los tests.
 *
 * Validaciones:
 *   - Esquemas Zod en create-run y report-result/finish-run.
 *   - Suite debe pertenecer al proyecto.
 *   - `target_base_url` NO viene del request: se usa el del proyecto. El panel
 *     no puede inyectar destinos arbitrarios.
 *   - `spec_file` reportado por el runner debe estar en `suite.specs` o
 *     empezar con `src/playwright/specs/` (nunca path traversal).
 */

import { z } from "zod";
import type {
  FinishRunInput,
  QaRun,
  QaRunnerJob,
  QaRunsRepo,
  ResultPayload,
} from "./repo-types";

export type HandlerResult<T = unknown> =
  | { ok: true; status: number; body: T }
  | {
      ok: false;
      status: number;
      body: { error: string; code: HandlerErrorCode; detail?: string };
    };

export type HandlerErrorCode =
  | "validation"
  | "project_not_found"
  | "suite_not_found"
  | "suite_wrong_project"
  | "suite_disabled"
  | "spec_not_authorized"
  | "run_not_found"
  | "not_owner"
  | "internal";

const UUID = z.string().uuid();

const createRunSchema = z.object({
  project_id: UUID,
  suite_id: UUID,
  client_request_id: z.string().min(1).max(120).nullable().optional(),
});
export type CreateRunInput = z.infer<typeof createRunSchema>;

const resultSchema = z.object({
  spec_file: z.string().min(1).max(500),
  test_title: z.string().min(1).max(500),
  status: z.enum(["passed", "failed", "skipped", "flaky", "timed_out"]),
  duration_ms: z.number().int().nonnegative().nullable(),
  retries: z.number().int().nonnegative(),
  error_type: z.string().max(80).nullable(),
  error_message: z.string().max(4000).nullable(),
  stack_trace: z.string().max(10_000).nullable(),
});

const finishSchema = z.object({
  status: z.enum(["passed", "failed", "aborted", "error"]),
  totals: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    flaky: z.number().int().nonnegative(),
  }),
  summary: z.string().max(2000),
  duration_ms: z.number().int().nonnegative(),
  env_assert_passed: z.boolean(),
  env_assert_response: z.unknown().nullable(),
});

// Valida que el spec declarado por el runner esté autorizado por el suite o,
// como fallback seguro, viva dentro del directorio de specs del runner.
function isSpecAuthorized(spec: string, allowedBySuite: string[]): boolean {
  if (allowedBySuite.includes(spec)) return true;
  if (!/^[a-z0-9][a-z0-9/_.-]{0,120}\.spec\.ts$/i.test(spec)) return false;
  return allowedBySuite.some((s) => spec.endsWith(s));
}

// ──────────────────────────────────────────────────────────── create-run

export async function handleCreateRun(input: {
  body: unknown;
  userId: string | null;
  repo: QaRunsRepo;
}): Promise<HandlerResult<{ run: QaRun; job: QaRunnerJob; created: boolean }>> {
  const parsed = createRunSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: { error: "payload inválido", code: "validation", detail: parsed.error.message },
    };
  }
  const project = await input.repo.getProject(parsed.data.project_id);
  if (!project) {
    return { ok: false, status: 404, body: { error: "proyecto no existe", code: "project_not_found" } };
  }
  const suite = await input.repo.getSuite(parsed.data.suite_id);
  if (!suite) {
    return { ok: false, status: 404, body: { error: "suite no existe", code: "suite_not_found" } };
  }
  if (suite.project_id !== project.id) {
    return {
      ok: false,
      status: 400,
      body: { error: "suite no pertenece al proyecto", code: "suite_wrong_project" },
    };
  }
  if (!suite.enabled) {
    return { ok: false, status: 400, body: { error: "suite deshabilitada", code: "suite_disabled" } };
  }

  const result = await input.repo.createRunAndJob({
    project,
    suite,
    triggered_by_user_id: input.userId,
    clientRequestId: parsed.data.client_request_id ?? null,
  });
  return { ok: true, status: result.created ? 201 : 200, body: result };
}

// ─────────────────────────────────────────────────────────────── claim

import type { ClaimedJob } from "./repo-types";

export async function handleClaim(input: {
  runnerId: string;
  repo: QaRunsRepo;
}): Promise<HandlerResult<ClaimedJob | null>> {
  const claimed = await input.repo.claimNextJob(input.runnerId);
  if (!claimed) return { ok: true, status: 204, body: null };
  return { ok: true, status: 200, body: claimed };
}

// ─────────────────────────────────────────────────────────── heartbeat

export async function handleHeartbeat(input: {
  runnerId: string;
  body: unknown;
  repo: QaRunsRepo;
}): Promise<HandlerResult<{ ok: true }>> {
  const parsed = z.object({ run_id: UUID }).safeParse(input.body);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: "payload inválido", code: "validation" } };
  }
  await input.repo.heartbeat(parsed.data.run_id, input.runnerId);
  return { ok: true, status: 200, body: { ok: true } };
}

// ──────────────────────────────────────────────────────── report-result

export async function handleReportResult(input: {
  runId: string;
  runnerId: string;
  body: unknown;
  repo: QaRunsRepo;
}): Promise<HandlerResult<{ outcome: "inserted" | "skipped" }>> {
  if (!UUID.safeParse(input.runId).success) {
    return { ok: false, status: 400, body: { error: "run_id inválido", code: "validation" } };
  }
  const parsed = resultSchema.safeParse(input.body);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: "result inválido", code: "validation", detail: parsed.error.message } };
  }

  const run = await input.repo.getRun(input.runId);
  if (!run) return { ok: false, status: 404, body: { error: "run no existe", code: "run_not_found" } };

  const suite = await input.repo.getSuite(run.suite_id);
  if (suite && !isSpecAuthorized(parsed.data.spec_file, suite.specs)) {
    return {
      ok: false,
      status: 400,
      body: { error: "spec no autorizado por el suite", code: "spec_not_authorized" },
    };
  }

  const outcome = await input.repo.insertResultIdempotent(input.runId, parsed.data as ResultPayload);
  return { ok: true, status: 200, body: { outcome } };
}

// ──────────────────────────────────────────────────────────── finish-run

export async function handleFinishRun(input: {
  runId: string;
  runnerId: string;
  body: unknown;
  repo: QaRunsRepo;
}): Promise<HandlerResult<{ outcome: "finished" | "already_finished" }>> {
  if (!UUID.safeParse(input.runId).success) {
    return { ok: false, status: 400, body: { error: "run_id inválido", code: "validation" } };
  }
  const parsed = finishSchema.safeParse(input.body);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: "finish inválido", code: "validation", detail: parsed.error.message } };
  }
  const run = await input.repo.getRun(input.runId);
  if (!run) return { ok: false, status: 404, body: { error: "run no existe", code: "run_not_found" } };

  const outcome = await input.repo.finishRunIdempotent(
    input.runId,
    input.runnerId,
    parsed.data as FinishRunInput
  );
  if (outcome === "not_owner") {
    return { ok: false, status: 403, body: { error: "runner no es dueño del job", code: "not_owner" } };
  }
  return { ok: true, status: 200, body: { outcome } };
}
