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
  | "project_entregado"
  | "project_no_autorizado"
  | "autorizacion_vencida"
  | "env_assert_failed"
  | "internal";

import { puedeEjecutarRun } from "./project-estado";

const UUID = z.string().uuid();

/**
 * Pre-flight env-assert del target. `QA_ENV=staging` por sí solo no alcanza:
 * exigimos que el endpoint responda prod_safe=true. Fail-closed ante cualquier
 * respuesta no esperada (404, HTML, 5xx, timeout, formato inválido).
 */
async function preflightEnvAssert(targetBaseUrl: string): Promise<{ ok: true } | { ok: false; razon: string }> {
  const url = targetBaseUrl.replace(/\/$/, "") + "/api/qa/env-assert";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, headers: { Accept: "application/json" } });
    if (res.status === 403) {
      return { ok: false, razon: "El target devolvió env-assert=forbidden_production. No se puede ejecutar." };
    }
    if (!res.ok) {
      return { ok: false, razon: `env-assert del target respondió HTTP ${res.status}.` };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return { ok: false, razon: "El target no expone /api/qa/env-assert como JSON. No es un entorno QA-ready." };
    }
    const body = (await res.json()) as { prod_safe?: unknown; reasons?: unknown };
    if (body.prod_safe !== true) {
      const reasons = Array.isArray(body.reasons) ? body.reasons.join(" · ") : "sin detalle";
      return { ok: false, razon: `env-assert devolvió prod_safe=false (${reasons}).` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, razon: `Error consultando env-assert: ${err instanceof Error ? err.message : "desconocido"}` };
  } finally {
    clearTimeout(timer);
  }
}

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
  /**
   * Función que valida el env-assert del target antes de encolar. Por default
   * hace `fetch` real a `target/api/qa/env-assert` y exige prod_safe=true.
   * En tests se puede inyectar un mock que devuelva {ok:true} sin red.
   */
  preflight?: (targetBaseUrl: string) => Promise<{ ok: true } | { ok: false; razon: string }>;
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

  // Gate de ciclo de vida: `entregado` bloquea TODO, sin autorización vigente no se encola.
  const veredicto = puedeEjecutarRun(project);
  if (!veredicto.ok) {
    const codeMap: Record<typeof veredicto.codigo, HandlerErrorCode> = {
      entregado: "project_entregado",
      no_autorizado: "project_no_autorizado",
      autorizacion_vencida: "autorizacion_vencida",
      estado_desconocido: "project_no_autorizado",
    };
    return { ok: false, status: 403, body: { error: veredicto.razon, code: codeMap[veredicto.codigo] } };
  }

  // Pre-flight env-assert: el runner lo valida antes de abrir el browser, pero
  // acá adelantamos el chequeo para no encolar jobs que el runner va a abortar.
  // Fail-closed: si env-assert no responde JSON válido con prod_safe=true, se rechaza.
  const envCheck = await (input.preflight ?? preflightEnvAssert)(project.target_base_url);
  if (!envCheck.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: envCheck.razon, code: "env_assert_failed" },
    };
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
  // Doble chequeo del estado al momento del claim: el proyecto puede haberse
  // marcado entregado o la autorización puede haber vencido entre el encolado
  // y el pick. Si falla, el job queda bloqueado y el runner no lo recibe.
  const veredicto = puedeEjecutarRun(claimed.project);
  if (!veredicto.ok) {
    return {
      ok: false,
      status: 403,
      body: { error: veredicto.razon, code: veredicto.codigo === "entregado" ? "project_entregado" : "project_no_autorizado" },
    };
  }
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
