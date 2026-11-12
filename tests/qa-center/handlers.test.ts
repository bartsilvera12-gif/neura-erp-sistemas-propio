import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleClaim,
  handleCreateRun,
  handleFinishRun,
  handleHeartbeat,
  handleReportResult,
} from "../../src/lib/qa/handlers";
import { InMemoryQaRunsRepo } from "../../src/lib/qa/repo-memory";
import type { QaProject, QaSuite } from "../../src/lib/qa/repo-types";

const PROJECT: QaProject = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "sistemas-propio",
  name: "ERP Central",
  target_base_url: "https://qa-sistemas.neura.test",
  target_env: "staging",
  default_branch: "main",
};
const SUITE: QaSuite = {
  id: "22222222-2222-4222-8222-222222222222",
  project_id: PROJECT.id,
  slug: "smoke",
  name: "Smoke",
  tags: ["smoke"],
  enabled: true,
  specs: ["availability.spec.ts"],
};

function seededRepo() {
  const repo = new InMemoryQaRunsRepo();
  repo.seedProject(PROJECT);
  repo.seedSuite(SUITE);
  return repo;
}

test("createRun: valida payload", async () => {
  const repo = seededRepo();
  const r = await handleCreateRun({ body: { project_id: "no-uuid" }, userId: null, repo });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "validation");
  }
});

test("createRun: rechaza suite de otro proyecto", async () => {
  const repo = seededRepo();
  repo.seedSuite({ ...SUITE, id: "33333333-3333-4333-8333-333333333333", project_id: "99999999-9999-4999-8999-999999999999" });
  const r = await handleCreateRun({
    body: { project_id: PROJECT.id, suite_id: "33333333-3333-4333-8333-333333333333" },
    userId: null,
    repo,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.body.code, "suite_wrong_project");
});

test("createRun: rechaza suite deshabilitado", async () => {
  const repo = seededRepo();
  repo.seedSuite({ ...SUITE, enabled: false });
  const r = await handleCreateRun({
    body: { project_id: PROJECT.id, suite_id: SUITE.id },
    userId: null,
    repo,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.body.code, "suite_disabled");
});

test("createRun: idempotente por client_request_id", async () => {
  const repo = seededRepo();
  const first = await handleCreateRun({
    body: { project_id: PROJECT.id, suite_id: SUITE.id, client_request_id: "cri-1" },
    userId: "u-1",
    repo,
  });
  const second = await handleCreateRun({
    body: { project_id: PROJECT.id, suite_id: SUITE.id, client_request_id: "cri-1" },
    userId: "u-1",
    repo,
  });
  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.body.created, true);
    assert.equal(second.body.created, false);
    assert.equal(first.body.run.id, second.body.run.id);
  }
});

test("claim: atómico — solo un runner se lleva el job", async () => {
  const repo = seededRepo();
  await handleCreateRun({
    body: { project_id: PROJECT.id, suite_id: SUITE.id },
    userId: null,
    repo,
  });
  // dos claims "simultáneos" sobre el mismo proceso: el 1ro gana, el 2do idle.
  const a = await handleClaim({ runnerId: "r-A", repo });
  const b = await handleClaim({ runnerId: "r-B", repo });
  assert.equal(a.ok && b.ok, true);
  if (a.ok && b.ok) {
    assert.notEqual(a.body, null);
    assert.equal(b.body, null); // b no encuentra nada que claim
  }
});

test("heartbeat: payload inválido → 400", async () => {
  const repo = seededRepo();
  const r = await handleHeartbeat({ runnerId: "r", body: {}, repo });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("reportResult: rechaza spec no autorizado por el suite", async () => {
  const repo = seededRepo();
  const created = await handleCreateRun({
    body: { project_id: PROJECT.id, suite_id: SUITE.id },
    userId: null,
    repo,
  });
  assert.equal(created.ok, true);
  const runId = created.ok ? created.body.run.id : "";
  const r = await handleReportResult({
    runId,
    runnerId: "r",
    body: {
      spec_file: "evil.spec.ts",
      test_title: "x",
      status: "passed",
      duration_ms: 1,
      retries: 0,
      error_type: null,
      error_message: null,
      stack_trace: null,
    },
    repo,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.body.code, "spec_not_authorized");
});

test("reportResult: idempotente por (spec_file, test_title)", async () => {
  const repo = seededRepo();
  const created = await handleCreateRun({
    body: { project_id: PROJECT.id, suite_id: SUITE.id },
    userId: null,
    repo,
  });
  assert.equal(created.ok, true);
  const runId = created.ok ? created.body.run.id : "";
  const payload = {
    spec_file: "availability.spec.ts",
    test_title: "GET / responde 200",
    status: "passed",
    duration_ms: 50,
    retries: 0,
    error_type: null,
    error_message: null,
    stack_trace: null,
  };
  const first = await handleReportResult({ runId, runnerId: "r", body: payload, repo });
  const second = await handleReportResult({ runId, runnerId: "r", body: payload, repo });
  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.body.outcome, "inserted");
    assert.equal(second.body.outcome, "skipped");
  }
});

test("finishRun: solo el claimer puede finalizar", async () => {
  const repo = seededRepo();
  await handleCreateRun({
    body: { project_id: PROJECT.id, suite_id: SUITE.id },
    userId: null,
    repo,
  });
  const claimed = await handleClaim({ runnerId: "r-owner", repo });
  assert.equal(claimed.ok, true);
  const runId = claimed.ok && claimed.body ? claimed.body.run.id : "";

  const payload = {
    status: "passed",
    totals: { passed: 1, failed: 0, skipped: 0, flaky: 0 },
    summary: "ok",
    duration_ms: 100,
    env_assert_passed: true,
    env_assert_response: null,
  };
  const foreign = await handleFinishRun({ runId, runnerId: "r-attacker", body: payload, repo });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.body.code, "not_owner");

  const owner = await handleFinishRun({ runId, runnerId: "r-owner", body: payload, repo });
  assert.equal(owner.ok, true);
  if (owner.ok) assert.equal(owner.body.outcome, "finished");

  // idempotente
  const again = await handleFinishRun({ runId, runnerId: "r-owner", body: payload, repo });
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.body.outcome, "already_finished");
});
