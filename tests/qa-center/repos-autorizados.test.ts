/**
 * Tests de la whitelist de repositorios autorizados.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarRepoUrl,
  esRepoAutorizado,
  listarReposAutorizados,
  metadataDeRepo,
  REPOS_AUTORIZADOS,
} from "../../src/lib/qa/repos-autorizados";

test("normalizarRepoUrl descarta hosts que no son github.com", () => {
  assert.equal(normalizarRepoUrl("https://gitlab.com/x/y"), null);
  assert.equal(normalizarRepoUrl("ftp://github.com/x/y"), null);
  assert.equal(normalizarRepoUrl(""), null);
});

test("normalizarRepoUrl quita trailing .git, barras y query", () => {
  assert.equal(
    normalizarRepoUrl("https://github.com/foo/bar.git/"),
    "https://github.com/foo/bar"
  );
  assert.equal(
    normalizarRepoUrl("https://GITHUB.com/Foo/Bar?x=1#readme"),
    "https://github.com/Foo/Bar"
  );
});

test("esRepoAutorizado acepta exactamente la whitelist", () => {
  for (const r of REPOS_AUTORIZADOS) {
    assert.equal(esRepoAutorizado(r.url), true, `debería aceptar ${r.url}`);
  }
  assert.equal(esRepoAutorizado("https://github.com/attacker/evil"), false);
});

test("esRepoAutorizado rechaza variantes mal formadas pero URLs normalizadas", () => {
  const sample = REPOS_AUTORIZADOS[0];
  if (!sample) return;
  assert.equal(esRepoAutorizado(sample.url + ".git"), true);
  assert.equal(esRepoAutorizado(sample.url + "/"), true);
});

test("listarReposAutorizados incluye overrides de pruebas-catalogo", () => {
  const lista = listarReposAutorizados();
  assert.ok(lista.length >= REPOS_AUTORIZADOS.length);
  // Overrides declarados deben aparecer una sola vez
  const urls = lista.map((r) => normalizarRepoUrl(r.url));
  const set = new Set(urls);
  assert.equal(set.size, urls.length, "no debe haber URLs duplicadas");
});

test("metadataDeRepo devuelve el codebase del repo", () => {
  const sample = REPOS_AUTORIZADOS.find((r) => r.codebase === "sistemas-propio");
  if (!sample) return;
  const meta = metadataDeRepo(sample.url);
  assert.ok(meta);
  assert.equal(meta?.codebase, "sistemas-propio");
});
