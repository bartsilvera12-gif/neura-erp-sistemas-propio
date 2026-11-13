/**
 * Tests del handler "Analizar ERP completo".
 * Usa el repo in-memory con seeds manuales.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handleAnalizarErp, AI_DISCOVERY_SUITE_PREFIX } from "../../src/lib/qa/handle-analizar-erp";
import { InMemoryQaRunsRepo } from "../../src/lib/qa/repo-memory";
import type { QaProject, QaSuite, QaRun, QaRunnerJob } from "../../src/lib/qa/repo-types";

function seedRepo(project: Partial<QaProject> = {}): { repo: InMemoryQaRunsRepo; project: QaProject } {
  const repo = new InMemoryQaRunsRepo();
  const p: QaProject = {
    id: randomUUID(),
    slug: "erp-roldan-pendiente-entrega",
    name: "Roldán",
    target_base_url: "https://roldanehijos.neura.com.py",
    target_env: "staging",
    default_branch: "main",
    estado_entrega: "en_desarrollo",
    autorizacion_qa_hasta: null,
    repo_url: null,
    permite_lectura_sin_env_assert: false,
    ...project,
  };
  repo.seedProject(p);
  // Inyectar createSuite/listSuitesForProject/createRunAndJob mínimos para el test
  // (el repo in-memory original no los tiene). Usamos el estado interno.
  const state = (repo as unknown as { state: { suites: Map<string, QaSuite>; runs: Map<string, QaRun>; runnerJobs: Map<string, QaRunnerJob> } }).state;
  const origCreateSuite = repo.createSuite.bind(repo);
  const origListSuites = repo.listSuitesForProject.bind(repo);
  repo.createSuite = async (input) => {
    const s: QaSuite = {
      id: randomUUID(),
      project_id: input.project_id,
      slug: input.slug,
      name: input.name,
      tags: input.tags ?? [],
      enabled: input.enabled ?? true,
      specs: input.specs,
    };
    state.suites.set(s.id, s);
    return s;
  };
  repo.listSuitesForProject = async (projectId) => {
    return [...state.suites.values()].filter((s) => s.project_id === projectId);
  };
  const origCreateRun = repo.createRunAndJob.bind(repo);
  repo.createRunAndJob = async (input) => {
    const run: QaRun = {
      id: randomUUID(),
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
      created_at: new Date().toISOString(),
    };
    state.runs.set(run.id, run);
    const job: QaRunnerJob = {
      id: randomUUID(),
      run_id: run.id,
      claimed_by: null,
      claimed_at: null,
      attempts: 0,
      max_attempts: 3,
      heartbeat_at: null,
      created_at: new Date().toISOString(),
    };
    return { run, job, created: true };
  };
  return { repo, project: p };
}

test("analizar-erp: 404 cuando el proyecto no existe", async () => {
  const { repo } = seedRepo();
  const r = await handleAnalizarErp({
    projectId: "00000000-0000-0000-0000-000000000000",
    userId: null,
    clientRequestId: null,
    repo,
  });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("");
  assert.equal(r.status, 404);
});

test("analizar-erp: 403 si el proyecto está entregado", async () => {
  const { repo, project } = seedRepo({ estado_entrega: "entregado" });
  const r = await handleAnalizarErp({ projectId: project.id, userId: null, clientRequestId: null, repo });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("");
  assert.equal(r.status, 403);
});

test("analizar-erp: 400 si no hay repo_url ni override conocido", async () => {
  const { repo, project } = seedRepo({
    slug: "proyecto-sin-mapa",
    target_base_url: "https://extranodominio.example.com",
  });
  const r = await handleAnalizarErp({ projectId: project.id, userId: null, clientRequestId: null, repo });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("");
  assert.equal(r.status, 400);
});

test("analizar-erp: 201 crea suite ai-discovery-<slug> y la reusa en 2da llamada", async () => {
  const { repo, project } = seedRepo();
  const first = await handleAnalizarErp({ projectId: project.id, userId: null, clientRequestId: "req-1", repo });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("");
  assert.equal(first.status, 201);
  const suites1 = await repo.listSuitesForProject(project.id);
  const auto = suites1.find((s) => s.slug.startsWith(AI_DISCOVERY_SUITE_PREFIX));
  assert.ok(auto, "falta suite ai-discovery-*");
  assert.equal(auto!.specs.length, 1);

  const second = await handleAnalizarErp({ projectId: project.id, userId: null, clientRequestId: "req-2", repo });
  assert.equal(second.ok, true);
  if (!second.ok) throw new Error("");
  const suites2 = await repo.listSuitesForProject(project.id);
  const autos = suites2.filter((s) => s.slug.startsWith(AI_DISCOVERY_SUITE_PREFIX));
  assert.equal(autos.length, 1, "la segunda llamada NO debe crear una suite nueva");
});
