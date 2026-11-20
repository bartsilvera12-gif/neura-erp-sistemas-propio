/**
 * Tests del ciclo estado_ejecucion en generated_specs (in-memory).
 * - updateGeneratedSpecEstado actualiza el estado.
 * - coberturaPorModuloParaCodebase agrega correctamente.
 * - listGeneratedSpecsForCodebase excluye blocked_safety.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryQaRunsRepo } from "../../src/lib/qa/repo-memory";

async function seedSpecs(repo: InMemoryQaRunsRepo, codebase: string): Promise<void> {
  await repo.upsertGeneratedSpecs({
    codebase,
    created_by_run_id: "00000000-0000-0000-0000-000000000001",
    specs: [
      { modulo: "ventas", spec_file: "auto-ventas-total.spec.ts", spec_source: "s1", source_sanitized_sha256: "a".repeat(64), invariante: "total ok", severidad: "major", requiere_sesion: true },
      { modulo: "ventas", spec_file: "auto-ventas-cabecera.spec.ts", spec_source: "s2", source_sanitized_sha256: "b".repeat(64), invariante: "cabecera ok", severidad: "minor", requiere_sesion: true },
      { modulo: "compras", spec_file: "auto-compras-total.spec.ts", spec_source: "s3", source_sanitized_sha256: "c".repeat(64), invariante: "total compras ok", severidad: "major", requiere_sesion: true },
    ],
  });
}

test("updateGeneratedSpecEstado actualiza el estado y last_error", async () => {
  const repo = new InMemoryQaRunsRepo();
  await seedSpecs(repo, "erp-neura");
  await repo.updateGeneratedSpecEstado({
    codebase: "erp-neura",
    spec_file: "auto-ventas-total.spec.ts",
    estado: "executed_pass",
    run_id: "00000000-0000-0000-0000-000000000002",
  });
  await repo.updateGeneratedSpecEstado({
    codebase: "erp-neura",
    spec_file: "auto-ventas-cabecera.spec.ts",
    estado: "executed_fail",
    run_id: "00000000-0000-0000-0000-000000000002",
    error_message: "asserción falló",
  });
  const cob = await repo.coberturaPorModuloParaCodebase("erp-neura");
  const ventas = cob.find((c) => c.modulo === "ventas");
  assert.ok(ventas);
  assert.equal(ventas!.executed_pass, 1);
  assert.equal(ventas!.executed_fail, 1);
});

test("listGeneratedSpecsForCodebase excluye blocked_safety", async () => {
  const repo = new InMemoryQaRunsRepo();
  await seedSpecs(repo, "erp-neura");
  await repo.updateGeneratedSpecEstado({
    codebase: "erp-neura",
    spec_file: "auto-ventas-total.spec.ts",
    estado: "blocked_safety",
    run_id: null,
  });
  const l = await repo.listGeneratedSpecsForCodebase("erp-neura");
  const files = l.map((x) => x.spec_file);
  assert.ok(!files.includes("auto-ventas-total.spec.ts"));
  assert.ok(files.includes("auto-ventas-cabecera.spec.ts"));
});

test("coberturaPorModuloParaCodebase cuenta correctamente blocked_env_assert", async () => {
  const repo = new InMemoryQaRunsRepo();
  await seedSpecs(repo, "erp-neura");
  await repo.updateGeneratedSpecEstado({
    codebase: "erp-neura",
    spec_file: "auto-compras-total.spec.ts",
    estado: "blocked_env_assert",
    run_id: null,
    error_message: "Toggle apagado",
  });
  const cob = await repo.coberturaPorModuloParaCodebase("erp-neura");
  const compras = cob.find((c) => c.modulo === "compras");
  assert.ok(compras);
  assert.equal(compras!.blocked_env_assert, 1);
  assert.equal(compras!.executed_pass, 0);
});
