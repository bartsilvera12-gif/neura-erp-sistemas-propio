import { test } from "node:test";
import assert from "node:assert/strict";
import {
  efectoDeSpec,
  nivelSeguridadDeSpecs,
  resolverRepoUrlProyecto,
} from "../../src/lib/qa/pruebas-catalogo";
import { handleCreateRun, handleReportFindings } from "../../src/lib/qa/handlers";
import { InMemoryQaRunsRepo } from "../../src/lib/qa/repo-memory";
import { randomUUID } from "node:crypto";

test("nivelSeguridadDeSpecs: 7 specs estáticas → static_analysis", () => {
  const specs = [
    "static-secret-scan.spec.ts",
    "static-service-role-usage.spec.ts",
    "static-unprotected-api-routes.spec.ts",
    "static-npm-audit.spec.ts",
    "static-security-headers.spec.ts",
    "static-env-assert-contract.spec.ts",
    "static-sql-injection-patterns.spec.ts",
  ];
  assert.equal(nivelSeguridadDeSpecs(specs), "static_analysis");
});

test("nivelSeguridadDeSpecs: mezcla estática + runtime → mixed_analysis", () => {
  const specs = ["static-secret-scan.spec.ts", "erp-neura-availability.spec.ts"];
  assert.equal(nivelSeguridadDeSpecs(specs), "mixed_analysis");
});

test("nivelSeguridadDeSpecs: anónimas runtime → anonymous_read_only", () => {
  const specs = ["erp-neura-availability.spec.ts", "erp-neura-login-page.spec.ts"];
  assert.equal(nivelSeguridadDeSpecs(specs), "anonymous_read_only");
});

test("efectoDeSpec: static spec → analisis_estatico", () => {
  assert.equal(efectoDeSpec("static-secret-scan.spec.ts"), "analisis_estatico");
});

test("resolverRepoUrlProyecto: Roldán override cuando DB está vacío", () => {
  assert.equal(
    resolverRepoUrlProyecto("erp-roldan-pendiente-entrega", null),
    "https://github.com/bartsilvera12-gif/neura-erp-roldan"
  );
  assert.equal(resolverRepoUrlProyecto("erp-roldan-pendiente-entrega", "https://foo.git"), "https://foo.git");
  assert.equal(resolverRepoUrlProyecto("otro-proyecto", null), null);
});

test("handleCreateRun: suite 100% estática no preflightea env-assert", async () => {
  const repo = new InMemoryQaRunsRepo();
  const projectId = randomUUID();
  const suiteId = randomUUID();
  repo.seedProject({
    id: projectId,
    slug: "erp-roldan-pendiente-entrega",
    name: "Roldán",
    target_base_url: "https://roldanehijos.neura.com.py",
    target_env: "staging",
    default_branch: "main",
    estado_entrega: "en_qa",
    autorizacion_qa_hasta: new Date(Date.now() + 86400_000).toISOString(),
  });
  repo.seedSuite({
    id: suiteId,
    project_id: projectId,
    slug: "estatic-20261113-1200",
    name: "Auditoría estática",
    tags: ["auditoria_estatica"],
    enabled: true,
    specs: ["static-secret-scan.spec.ts", "static-npm-audit.spec.ts"],
  });
  let preflightCalled = false;
  const result = await handleCreateRun({
    body: { project_id: projectId, suite_id: suiteId },
    userId: null,
    repo,
    preflight: async () => {
      preflightCalled = true;
      return { ok: false, razon: "no debería invocarse" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(preflightCalled, false);
});

test("handleCreateRun: suite mixta estática+runtime → 400 mixed_analysis", async () => {
  const repo = new InMemoryQaRunsRepo();
  const projectId = randomUUID();
  const suiteId = randomUUID();
  repo.seedProject({
    id: projectId,
    slug: "sistemas-propio-qa",
    name: "Sistemas Propio",
    target_base_url: "https://qa-sistemas.neura.com.py",
    target_env: "staging",
    default_branch: "main",
    estado_entrega: "en_qa",
    autorizacion_qa_hasta: new Date(Date.now() + 86400_000).toISOString(),
  });
  repo.seedSuite({
    id: suiteId,
    project_id: projectId,
    slug: "mixta",
    name: "Mixta",
    tags: [],
    enabled: true,
    specs: ["static-secret-scan.spec.ts", "erp-neura-availability.spec.ts"],
  });
  const result = await handleCreateRun({
    body: { project_id: projectId, suite_id: suiteId },
    userId: null,
    repo,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  if (!result.ok) assert.match(result.body.error, /mezclar/);
});

test("handleReportFindings: inserta findings y compone descripción con ubicación", async () => {
  const repo = new InMemoryQaRunsRepo();
  const projectId = randomUUID();
  const suiteId = randomUUID();
  repo.seedProject({
    id: projectId,
    slug: "x",
    name: "X",
    target_base_url: "https://x.test",
    target_env: "staging",
    default_branch: "main",
    estado_entrega: "en_qa",
    autorizacion_qa_hasta: new Date(Date.now() + 86400_000).toISOString(),
  });
  repo.seedSuite({
    id: suiteId,
    project_id: projectId,
    slug: "s",
    name: "s",
    tags: [],
    enabled: true,
    specs: ["static-secret-scan.spec.ts"],
  });
  const run = await repo.createRunAndJob({
    project: (await repo.getProject(projectId))!,
    suite: (await repo.getSuite(suiteId))!,
    triggered_by_user_id: null,
    clientRequestId: null,
  });

  const r = await handleReportFindings({
    runnerId: "runner-1",
    body: {
      run_id: run.run.id,
      project_id: projectId,
      findings: [
        {
          spec_file: "static-secret-scan.spec.ts",
          title: "Secreto hardcodeado — JWT",
          description: "Token Supabase en el código.",
          severity: "blocker",
          file: "src/lib/config.ts",
          line: 3,
          evidence: ">  3 | const K = \"eyJ...\";",
        },
      ],
    },
    repo,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.body.inserted, 1);
  assert.equal(repo.insertedFindings.length, 1);
  const inserted = repo.insertedFindings[0]!;
  assert.equal(inserted.severity, "blocker");
  assert.match(inserted.description, /src\/lib\/config\.ts:3/);
  assert.match(inserted.description, /Evidencia:/);
});

test("handleReportFindings: project_id mismatch → 400", async () => {
  const repo = new InMemoryQaRunsRepo();
  const projectId = randomUUID();
  const suiteId = randomUUID();
  repo.seedProject({
    id: projectId,
    slug: "x",
    name: "X",
    target_base_url: "https://x.test",
    target_env: "staging",
    default_branch: "main",
    estado_entrega: "en_qa",
    autorizacion_qa_hasta: new Date(Date.now() + 86400_000).toISOString(),
  });
  repo.seedSuite({
    id: suiteId,
    project_id: projectId,
    slug: "s",
    name: "s",
    tags: [],
    enabled: true,
    specs: ["static-secret-scan.spec.ts"],
  });
  const run = await repo.createRunAndJob({
    project: (await repo.getProject(projectId))!,
    suite: (await repo.getSuite(suiteId))!,
    triggered_by_user_id: null,
    clientRequestId: null,
  });

  const r = await handleReportFindings({
    runnerId: "runner-1",
    body: {
      run_id: run.run.id,
      project_id: randomUUID(), // mismatch
      findings: [
        { spec_file: "x", title: "t", description: "", severity: "info", file: "", line: null, evidence: "" },
      ],
    },
    repo,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});
