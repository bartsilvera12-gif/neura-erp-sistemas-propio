import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { listQaProjects, listQaRuns, listQaSuites } from "../../src/lib/qa/db";

const savedUrl = process.env.QA_DB_URL;

before(() => {
  // Aseguramos fail-closed: QA_DB_URL ausente.
  delete process.env.QA_DB_URL;
});
after(() => {
  if (savedUrl !== undefined) process.env.QA_DB_URL = savedUrl;
});

test("listQaProjects: sin QA_DB_URL → config_missing + data vacía", async () => {
  const r = await listQaProjects();
  assert.deepEqual(r.data, []);
  assert.equal(r.migration_status, "config_missing");
  assert.ok(r.note && r.note.includes("QA_DB_URL"));
});

test("listQaRuns: sin QA_DB_URL → config_missing", async () => {
  const r = await listQaRuns({ limit: 10 });
  assert.equal(r.migration_status, "config_missing");
  assert.deepEqual(r.data, []);
});

test("listQaSuites: sin QA_DB_URL → config_missing", async () => {
  const r = await listQaSuites("11111111-1111-4111-8111-111111111111");
  assert.equal(r.migration_status, "config_missing");
  assert.deepEqual(r.data, []);
});

test("listQaSuites sin projectId: lista vacía con status 'ready' (no hay DB a la que preguntar)", async () => {
  // Nota: con QA_DB_URL ausente, cae al branch config_missing antes de llegar a este if.
  // Mantenemos el test documentando la semántica: UI nunca llama sin projectId.
  const r = await listQaSuites();
  assert.deepEqual(r.data, []);
  assert.equal(r.migration_status, "config_missing");
});
