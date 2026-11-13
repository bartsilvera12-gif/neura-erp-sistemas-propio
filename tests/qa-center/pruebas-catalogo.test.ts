/**
 * Tests del catálogo de pruebas: whitelist, compatibilidad por proyecto,
 * y que las specs declaradas existen físicamente en el runner.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CATALOGO_PRUEBAS,
  pruebasParaProyecto,
  specsPermitidas,
  derivarSlugSuite,
} from "../../src/lib/qa/pruebas-catalogo";

const RUNNER_SPECS_DIR = resolve(process.cwd(), "..", "qa-runner", "src", "playwright", "specs");

test("catálogo: cada spec_file apunta a un archivo .spec.ts real del runner", () => {
  for (const p of CATALOGO_PRUEBAS) {
    assert.match(p.spec_file, /^[A-Za-z0-9_\-.]+\.spec\.ts$/, `spec_file inválido: ${p.spec_file}`);
    const abs = resolve(RUNNER_SPECS_DIR, p.spec_file);
    assert.ok(existsSync(abs), `no existe en runner: ${abs}`);
  }
});

test("catálogo: slugs/spec_file únicos, tests > 0, nombre y descripción no vacíos", () => {
  const vistos = new Set<string>();
  for (const p of CATALOGO_PRUEBAS) {
    assert.ok(!vistos.has(p.spec_file), `duplicado: ${p.spec_file}`);
    vistos.add(p.spec_file);
    assert.ok(p.tests > 0, `tests debe ser > 0 para ${p.spec_file}`);
    assert.ok(p.nombre.length >= 3, `nombre vacío en ${p.spec_file}`);
    assert.ok(p.descripcion.length >= 10, `descripción corta en ${p.spec_file}`);
  }
});

test("specsPermitidas(): retorna todas las del catálogo", () => {
  const set = specsPermitidas();
  for (const p of CATALOGO_PRUEBAS) assert.ok(set.has(p.spec_file));
  assert.equal(set.size, CATALOGO_PRUEBAS.length);
});

test("pruebasParaProyecto: target productivo → lista vacía", () => {
  const grupos = pruebasParaProyecto({
    slug: "cualquiera",
    target_base_url: "https://sistemas.neura.com.py",
    target_env: "staging",
  });
  assert.equal(grupos.length, 0, "no debe haber pruebas contra hosts productivos");
});

test("pruebasParaProyecto: QA sobre sistemas-propio → incluye disponibilidad + login-page + seguridad", () => {
  const grupos = pruebasParaProyecto({
    slug: "sistemas-propio-qa",
    target_base_url: "https://qa-sistemas.neura.com.py",
    target_env: "staging",
  });
  const todas = grupos.flatMap((g) => g.pruebas.map((p) => p.spec_file));
  assert.ok(todas.includes("availability.spec.ts"), "falta availability");
  assert.ok(todas.includes("sistemas-propio-login-page.spec.ts"), "falta login-page específico");
  assert.ok(todas.includes("sistemas-propio-seguridad.spec.ts"), "falta seguridad específica");
});

test("pruebasParaProyecto: proyecto genérico localhost → excluye las específicas de sistemas-propio sólo si slug no matchea", () => {
  // localhost matchea esSistemasPropio (host whitelist), por lo cual incluye las específicas.
  const grupos = pruebasParaProyecto({
    slug: "demo-x",
    target_base_url: "http://localhost:3000",
    target_env: "local",
  });
  const todas = grupos.flatMap((g) => g.pruebas.map((p) => p.spec_file));
  assert.ok(todas.includes("availability.spec.ts"));
  assert.ok(todas.includes("sistemas-propio-login-page.spec.ts"));
});

test("pruebasParaProyecto: host no productivo pero no sistemas-propio → sólo las genéricas", () => {
  const grupos = pruebasParaProyecto({
    slug: "otro-cliente-demo",
    target_base_url: "https://staging.otrocliente.example",
    target_env: "staging",
  });
  const todas = grupos.flatMap((g) => g.pruebas.map((p) => p.spec_file));
  assert.ok(todas.includes("availability.spec.ts"));
  assert.ok(!todas.includes("sistemas-propio-login-page.spec.ts"), "no debería ofrecerse para otro cliente");
  assert.ok(!todas.includes("sistemas-propio-seguridad.spec.ts"));
});

test("derivarSlugSuite: genera slug kebab-case ordenado + timestamp (≤40 chars)", () => {
  const d = new Date("2026-11-13T14:30:45.000Z");
  const slug = derivarSlugSuite(["seguridad", "disponibilidad"], d);
  assert.equal(slug, "disp-sec-202611131430");
  assert.ok(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug), `slug inválido: ${slug}`);
  assert.ok(slug.length <= 40, `supera 40 chars: ${slug.length}`);
});

test("derivarSlugSuite: los 4 tipos combinados siguen entrando en ≤40 chars y pasan la regex", () => {
  const d = new Date("2026-11-13T14:30:45.000Z");
  const slug = derivarSlugSuite(["disponibilidad", "inicio_sesion", "navegacion", "seguridad"], d);
  assert.equal(slug, "disp-login-nav-sec-202611131430");
  assert.ok(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug));
  assert.ok(slug.length <= 40);
});

test("derivarSlugSuite: sin tipos usa 'suite' como base", () => {
  const d = new Date("2026-01-02T03:04:05.000Z");
  const slug = derivarSlugSuite([], d);
  assert.equal(slug, "suite-202601020304");
  assert.ok(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug));
});

test("derivarSlugSuite: incluir inicio_sesion ya no rompe la validación kebab", () => {
  const d = new Date("2026-11-13T14:30:45.000Z");
  const slug = derivarSlugSuite(["inicio_sesion"], d);
  assert.equal(slug, "login-202611131430");
  assert.ok(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug), `slug con underscore inválido: ${slug}`);
});
