import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nivelSeguridadDeSpecs,
  CATALOGO_PRUEBAS,
} from "../../src/lib/qa/pruebas-catalogo";
import { handleCreateRun, handleReportFindings } from "../../src/lib/qa/handlers";
import { InMemoryQaRunsRepo } from "../../src/lib/qa/repo-memory";

const SPEC_RO_1 = "funcional/ventas.spec.ts";
const SPEC_RO_2 = "funcional/compras.spec.ts";
const SPEC_ANON = "erp-neura-availability.spec.ts";

// UUIDs v4 válidos (la validación Zod rechaza "0000..." como versión inválida).
// Formato: XXXXXXXX-XXXX-4XXX-[89ab]XXX-XXXXXXXXXXXX (bloques de 8-4-4-4-12).
function uuid(seed: number): string {
  const h = seed.toString(16).padStart(8, "0");
  // 8-4-4-4-12
  return `${h}-1234-4567-8901-cafe${h}`;
}

test("nivelSeguridadDeSpecs: 2 specs funcionales → authenticated_read_only", () => {
  assert.equal(nivelSeguridadDeSpecs([SPEC_RO_1, SPEC_RO_2]), "authenticated_read_only");
});

test("nivelSeguridadDeSpecs: funcional + anónima → auth_read_only o standard", () => {
  // Mezclar RO-estricta con anónima runtime: el gate correcto es el más
  // restrictivo. Hoy devolvemos authenticated_read_only (porque habrá sesión
  // activa de la ro-estricta); podría endurecerse a standard sin romper el
  // contrato de seguridad.
  const nivel = nivelSeguridadDeSpecs([SPEC_RO_1, SPEC_ANON]);
  assert.ok(
    nivel === "authenticated_read_only" || nivel === "standard",
    `nivel inesperado: ${nivel}`
  );
});

test("CATALOGO_PRUEBAS: incluye al menos 18 entradas de auditoria_funcional_negocio", () => {
  const funcionales = CATALOGO_PRUEBAS.filter((p) => p.tipo === "auditoria_funcional_negocio");
  assert.ok(funcionales.length >= 18, `esperaba ≥18, hay ${funcionales.length}`);
});

test("CATALOGO_PRUEBAS: todas las funcionales son solo_lectura_estricta", () => {
  const funcionales = CATALOGO_PRUEBAS.filter((p) => p.tipo === "auditoria_funcional_negocio");
  for (const p of funcionales) {
    assert.equal(p.solo_lectura_estricta, true, `${p.nombre}: debe ser solo_lectura_estricta`);
    assert.equal(p.efecto, "lectura_autenticada_estricta", `${p.nombre}: efecto incorrecto`);
    assert.ok(p.modulo_negocio && p.modulo_negocio.length > 0, `${p.nombre}: sin módulo`);
  }
});

test("CATALOGO_PRUEBAS: los 7 módulos están cubiertos", () => {
  const funcionales = CATALOGO_PRUEBAS.filter((p) => p.tipo === "auditoria_funcional_negocio");
  const modulos = new Set(funcionales.map((p) => p.modulo_negocio));
  for (const m of ["Ventas", "Compras", "Inventario", "Caja", "Clientes", "Cobranzas", "Reportes"]) {
    assert.ok(modulos.has(m), `módulo ${m} sin pruebas`);
  }
});

test("handleCreateRun con permite_lectura_sin_env_assert=true saltea env-assert", async () => {
  const repo = new InMemoryQaRunsRepo();
  const projectId = uuid(1);
  const suiteId = uuid(2);
  repo.seedProject({
    id: projectId,
    slug: "test-ro",
    name: "Test RO",
    target_base_url: "https://test.example.com",
    target_env: "staging",
    default_branch: "main",
    estado_entrega: "en_qa",
    autorizacion_qa_hasta: new Date(Date.now() + 86400_000).toISOString(),
    permite_lectura_sin_env_assert: true,
  });
  repo.seedSuite({
    id: suiteId,
    project_id: projectId,
    slug: "ro",
    name: "RO",
    tags: [],
    enabled: true,
    specs: [SPEC_RO_1, SPEC_RO_2],
  });
  let preflightLlamado = false;
  const result = await handleCreateRun({
    body: { project_id: projectId, suite_id: suiteId },
    userId: null,
    repo,
    preflight: async () => {
      preflightLlamado = true;
      return { ok: false, razon: "no debería llamarse" };
    },
  });
  assert.equal(result.ok, true, `createRun debería OK: ${JSON.stringify(result)}`);
  assert.equal(preflightLlamado, false, "preflight NO debe llamarse cuando el admin autorizó");
});

test("handleCreateRun con permite_lectura_sin_env_assert=false consulta env-assert", async () => {
  const repo = new InMemoryQaRunsRepo();
  const projectId = uuid(3);
  const suiteId = uuid(4);
  repo.seedProject({
    id: projectId,
    slug: "test-ro-2",
    name: "Test RO 2",
    target_base_url: "https://test.example.com",
    target_env: "staging",
    default_branch: "main",
    estado_entrega: "en_qa",
    autorizacion_qa_hasta: new Date(Date.now() + 86400_000).toISOString(),
    permite_lectura_sin_env_assert: false,
  });
  repo.seedSuite({
    id: suiteId,
    project_id: projectId,
    slug: "ro2",
    name: "RO 2",
    tags: [],
    enabled: true,
    specs: [SPEC_RO_1],
  });
  let preflightLlamado = false;
  await handleCreateRun({
    body: { project_id: projectId, suite_id: suiteId },
    userId: null,
    repo,
    preflight: async () => {
      preflightLlamado = true;
      return { ok: true };
    },
  });
  assert.equal(preflightLlamado, true, "preflight SÍ debe llamarse cuando el admin no autorizó");
});

test("handleReportFindings persiste campos funcionales", async () => {
  const repo = new InMemoryQaRunsRepo();
  const projectId = uuid(5);
  const suiteId = uuid(6);
  repo.seedProject({
    id: projectId,
    slug: "test-find",
    name: "Test Find",
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
    name: "S",
    tags: [],
    enabled: true,
    specs: [SPEC_RO_1],
  });
  const create = await handleCreateRun({
    body: { project_id: projectId, suite_id: suiteId },
    userId: null,
    repo,
    preflight: async () => ({ ok: true }),
  });
  assert.equal(create.ok, true);
  const runId = create.ok ? create.body.run.id : "";
  const res = await handleReportFindings({
    runnerId: "r1",
    body: {
      run_id: runId,
      project_id: projectId,
      findings: [
        {
          spec_file: SPEC_RO_1,
          title: "Ventas · total no coincide",
          description: "descripción",
          severity: "major",
          file: "",
          line: null,
          evidence: "",
          funcion_revisada: "Suma de ítems vs total",
          resultado_esperado: "100000",
          resultado_obtenido: "99500",
          recomendacion: "Revisar el cálculo en ventas/create",
          evidencia_url: "https://evidence.example/screenshot.png",
          modulo_negocio: "Ventas",
        },
      ],
    },
    repo,
  });
  assert.equal(res.ok, true, `insert debería OK: ${JSON.stringify(res)}`);
  assert.equal(repo.insertedFindings.length, 1);
  assert.equal(repo.insertedFindings[0].funcion_revisada, "Suma de ítems vs total");
  assert.equal(repo.insertedFindings[0].modulo_negocio, "Ventas");
  assert.equal(repo.insertedFindings[0].recomendacion, "Revisar el cálculo en ventas/create");
});
