import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresQaRunsRepo, type QaExecutor } from "../../src/lib/qa/repo-pg";
import type { QaProject, QaSuite } from "../../src/lib/qa/repo-types";

const PROJECT: QaProject = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "p",
  name: "P",
  target_base_url: "http://127.0.0.1:4555",
  target_env: "local",
  default_branch: "main",
  estado_entrega: "en_qa",
  autorizacion_qa_hasta: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
};
const SUITE: QaSuite = {
  id: "22222222-2222-4222-8222-222222222222",
  project_id: PROJECT.id,
  slug: "smoke",
  name: "Smoke",
  tags: ["smoke"],
  specs: ["availability.spec.ts"],
  enabled: true,
};

/** Executor mockeado: captura queries + devuelve rows configuradas por regex. */
function mockExec(
  handlers: Array<{ match: RegExp; rows?: Record<string, unknown>[]; throws?: Error }>
): { exec: QaExecutor; calls: Array<{ text: string; params: unknown[] }> } {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const exec: QaExecutor = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params: params ?? [] });
      for (const h of handlers) {
        if (h.match.test(text)) {
          if (h.throws) throw h.throws;
          return { rows: h.rows ?? [], rowCount: (h.rows ?? []).length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { exec, calls };
}

test("getProject: query parametrizada + WHERE archived_at IS NULL", async () => {
  const { exec, calls } = mockExec([
    { match: /SELECT .* FROM qa_center\.projects/, rows: [{ id: PROJECT.id, slug: "p", name: "P", target_base_url: "http://x", target_env: "local", default_branch: "main" }] },
  ]);
  const repo = new PostgresQaRunsRepo(exec);
  const p = await repo.getProject(PROJECT.id);
  assert.equal(p?.id, PROJECT.id);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /WHERE id = \$1 AND archived_at IS NULL/);
  assert.deepEqual(calls[0]!.params, [PROJECT.id]);
});

test("getSuite: mapea tags y specs vacíos cuando null", async () => {
  const { exec } = mockExec([
    { match: /FROM qa_center\.suites/, rows: [{ id: SUITE.id, project_id: PROJECT.id, slug: "s", name: "s", tags: null, specs: null, enabled: true }] },
  ]);
  const repo = new PostgresQaRunsRepo(exec);
  const s = await repo.getSuite(SUITE.id);
  assert.deepEqual(s?.tags, []);
  assert.deepEqual(s?.specs, []);
});

test("insertResultIdempotent: INSERT ... ON CONFLICT DO NOTHING RETURNING id", async () => {
  // Primera inserción: devuelve una fila (inserted).
  const { exec: e1 } = mockExec([
    { match: /INSERT INTO qa_center\.results/, rows: [{ id: "r1" }] },
  ]);
  const r1 = new PostgresQaRunsRepo(e1);
  const ins = await r1.insertResultIdempotent("run-1", {
    spec_file: "a.spec.ts", test_title: "t", status: "passed",
    duration_ms: 10, retries: 0, error_type: null, error_message: null, stack_trace: null,
  });
  assert.equal(ins, "inserted");

  // Segunda inserción: 0 filas (ON CONFLICT DO NOTHING) → skipped.
  const { exec: e2, calls } = mockExec([
    { match: /INSERT INTO qa_center\.results/, rows: [] },
  ]);
  const r2 = new PostgresQaRunsRepo(e2);
  const skip = await r2.insertResultIdempotent("run-1", {
    spec_file: "a.spec.ts", test_title: "t", status: "failed",
    duration_ms: 99, retries: 1, error_type: null, error_message: null, stack_trace: null,
  });
  assert.equal(skip, "skipped");
  assert.match(calls[0]!.text, /ON CONFLICT \(run_id, spec_file, test_title\) DO NOTHING/);
});

test("finishRunIdempotent: rechaza no-owner y no corre el UPDATE", async () => {
  let updateCalled = false;
  const { exec } = mockExec([
    { match: /SELECT claimed_by FROM qa_center\.runner_jobs/, rows: [{ claimed_by: "worker-A" }] },
    { match: /UPDATE qa_center\.runs/, rows: [] },
  ]);
  const wrapped: QaExecutor = {
    async query(text: string, p?: unknown[]) {
      if (/UPDATE qa_center\.runs/.test(text)) updateCalled = true;
      return exec.query(text, p);
    },
  };
  const repo = new PostgresQaRunsRepo(wrapped);
  const out = await repo.finishRunIdempotent("run-1", "attacker", {
    status: "passed",
    totals: { passed: 1, failed: 0, skipped: 0, flaky: 0 },
    summary: "ok", duration_ms: 1, env_assert_passed: true, env_assert_response: null,
  });
  assert.equal(out, "not_owner");
  assert.equal(updateCalled, false);
});

test("finishRunIdempotent: owner correcto → finished; segundo intento → already_finished", async () => {
  // owner match + UPDATE devuelve 1 fila → finished
  const { exec: eA } = mockExec([
    { match: /SELECT claimed_by FROM qa_center\.runner_jobs/, rows: [{ claimed_by: "worker-A" }] },
    { match: /UPDATE qa_center\.runs/, rows: [{ id: "run-1" }] },
  ]);
  const a = await new PostgresQaRunsRepo(eA).finishRunIdempotent("run-1", "worker-A", {
    status: "passed", totals: { passed: 1, failed: 0, skipped: 0, flaky: 0 },
    summary: "ok", duration_ms: 1, env_assert_passed: true, env_assert_response: null,
  });
  assert.equal(a, "finished");

  // Segundo intento: UPDATE devuelve 0 filas → already_finished.
  const { exec: eB } = mockExec([
    { match: /SELECT claimed_by FROM qa_center\.runner_jobs/, rows: [{ claimed_by: "worker-A" }] },
    { match: /UPDATE qa_center\.runs/, rows: [] },
  ]);
  const b = await new PostgresQaRunsRepo(eB).finishRunIdempotent("run-1", "worker-A", {
    status: "passed", totals: { passed: 1, failed: 0, skipped: 0, flaky: 0 },
    summary: "ok", duration_ms: 1, env_assert_passed: true, env_assert_response: null,
  });
  assert.equal(b, "already_finished");
});

test("claimNextJob: usa RPC qa_center.claim_next_job + UPDATE run → running", async () => {
  const { exec, calls } = mockExec([
    { match: /FROM qa_center\.claim_next_job/, rows: [{ id: "job-1", run_id: "run-1", claimed_by: "worker", claimed_at: new Date().toISOString(), attempts: 1, max_attempts: 3, heartbeat_at: new Date().toISOString(), created_at: new Date().toISOString() }] },
    { match: /UPDATE qa_center\.runs/, rows: [{ id: "run-1", project_id: PROJECT.id, suite_id: SUITE.id, status: "running", trigger: "manual", target_base_url: "x", target_env: "local", triggered_by_user_id: null, triggered_by_ref: null, totals: null, env_assert_passed: null, env_assert_response: null, summary: null, duration_ms: null, started_at: new Date().toISOString(), finished_at: null, created_at: new Date().toISOString() }] },
    { match: /FROM qa_center\.projects/, rows: [{ id: PROJECT.id, slug: "p", name: "P", target_base_url: "x", target_env: "local", default_branch: "main" }] },
    { match: /FROM qa_center\.suites/, rows: [{ id: SUITE.id, project_id: PROJECT.id, slug: "s", name: "s", tags: ["x"], specs: ["a.spec.ts"], enabled: true }] },
  ]);
  const repo = new PostgresQaRunsRepo(exec);
  const claimed = await repo.claimNextJob("worker");
  assert.ok(claimed);
  assert.equal(claimed!.job.run_id, "run-1");
  assert.equal(claimed!.run.status, "running");
  assert.match(calls[0]!.text, /qa_center\.claim_next_job\(\$1\)/);
  assert.deepEqual(calls[0]!.params, ["worker"]);
});

test("claimNextJob: cola vacía (first row id=null) → null", async () => {
  const { exec } = mockExec([
    { match: /FROM qa_center\.claim_next_job/, rows: [{ id: null }] },
  ]);
  const out = await new PostgresQaRunsRepo(exec).claimNextJob("w");
  assert.equal(out, null);
});

test("heartbeat: UPDATE con filtro claim_by + run_id (parametrizado)", async () => {
  const { exec, calls } = mockExec([
    { match: /UPDATE qa_center\.runner_jobs/, rows: [] },
  ]);
  await new PostgresQaRunsRepo(exec).heartbeat("run-1", "worker-A");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /WHERE run_id = \$1 AND claimed_by = \$2/);
  assert.deepEqual(calls[0]!.params, ["run-1", "worker-A"]);
});

test("listRecentRuns: LIMIT clampa a [1,200]", async () => {
  const { exec, calls } = mockExec([{ match: /FROM qa_center\.runs/, rows: [] }]);
  await new PostgresQaRunsRepo(exec).listRecentRuns(99_999);
  assert.deepEqual(calls[0]!.params, [200]);

  const { exec: e2, calls: c2 } = mockExec([{ match: /FROM qa_center\.runs/, rows: [] }]);
  await new PostgresQaRunsRepo(e2).listRecentRuns(0);
  assert.deepEqual(c2[0]!.params, [1]);
});

test("createRunAndJob: idempotencia por client_request_id reusa run existente", async () => {
  const existingRun = {
    id: "run-existing", project_id: PROJECT.id, suite_id: SUITE.id, status: "queued",
    trigger: "manual", target_base_url: "x", target_env: "local",
    triggered_by_user_id: null, triggered_by_ref: "cri-1",
    totals: null, env_assert_passed: null, env_assert_response: null, summary: null,
    duration_ms: null, started_at: null, finished_at: null, created_at: new Date().toISOString(),
  };
  const existingJob = {
    id: "job-existing", run_id: "run-existing", claimed_by: null, claimed_at: null,
    attempts: 0, max_attempts: 3, heartbeat_at: null, created_at: new Date().toISOString(),
  };
  const { exec } = mockExec([
    { match: /SELECT .* FROM qa_center\.runs\s+WHERE project_id = \$1 AND suite_id = \$2\s+AND triggered_by_ref/, rows: [existingRun] },
    { match: /SELECT .* FROM qa_center\.runner_jobs WHERE run_id = \$1/, rows: [existingJob] },
  ]);
  const out = await new PostgresQaRunsRepo(exec).createRunAndJob({
    project: PROJECT, suite: SUITE, triggered_by_user_id: null, clientRequestId: "cri-1",
  });
  assert.equal(out.created, false);
  assert.equal(out.run.id, "run-existing");
});
