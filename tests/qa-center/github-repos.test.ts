/**
 * Tests del cliente GitHub dinámico.
 * Mockea fetch global para no pegarle a GitHub real.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  listarReposDeGithub,
  verificarRepoAutorizado,
  __limpiarCacheReposGithub,
} from "../../src/lib/qa/github-repos";

const originalFetch = global.fetch;
let calls: { url: string; init?: RequestInit }[] = [];

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>): void {
  (global as unknown as { fetch: typeof fetch }).fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push({ url: u, init });
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (u.startsWith(pattern)) return handler(init);
    }
    return new Response(JSON.stringify({ error: "mock: no handler" }), { status: 500 });
  };
}

beforeEach(() => {
  calls = [];
  __limpiarCacheReposGithub();
  process.env.GITHUB_TOKEN = "test-token";
  delete process.env.QA_GITHUB_ALLOWED_OWNERS;
});
afterEach(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
});

test("listarReposDeGithub sin token → error no_token", async () => {
  delete process.env.GITHUB_TOKEN;
  const out = await listarReposDeGithub({});
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, "no_token");
});

test("listarReposDeGithub usa owners del token cuando no hay env", async () => {
  mockFetch({
    "https://api.github.com/user/repos": () =>
      new Response(JSON.stringify([
        { name: "neura-erp-roldan", full_name: "bart/neura-erp-roldan", owner: { login: "bart" }, html_url: "https://github.com/bart/neura-erp-roldan", default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
        { name: "extra", full_name: "other/extra", owner: { login: "other" }, html_url: "https://github.com/other/extra", default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
      ]), { status: 200 }),
    "https://api.github.com/user": () =>
      new Response(JSON.stringify({ login: "bart" }), { status: 200 }),
  });
  const out = await listarReposDeGithub({});
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.allowed_owners, ["bart"]);
  assert.equal(out.repos.length, 1); // "other/extra" filtrado
  assert.equal(out.repos[0]?.owner, "bart");
});

test("listarReposDeGithub respeta QA_GITHUB_ALLOWED_OWNERS", async () => {
  process.env.QA_GITHUB_ALLOWED_OWNERS = "neura-org, bart";
  mockFetch({
    "https://api.github.com/user/repos": () =>
      new Response(JSON.stringify([
        { name: "r1", full_name: "neura-org/r1", owner: { login: "neura-org" }, html_url: "https://github.com/neura-org/r1", default_branch: "main", private: true, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
        { name: "r2", full_name: "bart/r2", owner: { login: "bart" }, html_url: "https://github.com/bart/r2", default_branch: "dev", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
        { name: "r3", full_name: "other/r3", owner: { login: "other" }, html_url: "https://github.com/other/r3", default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
      ]), { status: 200 }),
  });
  const out = await listarReposDeGithub({});
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.allowed_owners, ["neura-org", "bart"]);
  assert.equal(out.repos.length, 2);
});

test("listarReposDeGithub aplica filtro q", async () => {
  process.env.QA_GITHUB_ALLOWED_OWNERS = "bart";
  mockFetch({
    "https://api.github.com/user/repos": () =>
      new Response(JSON.stringify([
        { name: "neura-erp-roldan", full_name: "bart/neura-erp-roldan", owner: { login: "bart" }, html_url: "https://github.com/bart/neura-erp-roldan", default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
        { name: "mevo-vendedores", full_name: "bart/mevo-vendedores", owner: { login: "bart" }, html_url: "https://github.com/bart/mevo-vendedores", default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
      ]), { status: 200 }),
  });
  const out = await listarReposDeGithub({ q: "roldan" });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.repos.length, 1);
  assert.equal(out.repos[0]?.name, "neura-erp-roldan");
});

test("listarReposDeGithub pagina correctamente", async () => {
  process.env.QA_GITHUB_ALLOWED_OWNERS = "bart";
  const repos = Array.from({ length: 7 }, (_, i) => ({
    name: `r${i}`, full_name: `bart/r${i}`, owner: { login: "bart" },
    html_url: `https://github.com/bart/r${i}`, default_branch: "main", private: false,
    updated_at: "2026-01-01T00:00:00Z", archived: false, description: null,
  }));
  mockFetch({
    "https://api.github.com/user/repos": () =>
      new Response(JSON.stringify(repos), { status: 200 }),
  });
  const p1 = await listarReposDeGithub({ page: 1, per_page: 3 });
  assert.equal(p1.ok, true);
  if (!p1.ok) return;
  assert.equal(p1.repos.length, 3);
  assert.equal(p1.has_more, true);
  const p3 = await listarReposDeGithub({ page: 3, per_page: 3 });
  assert.equal(p3.ok, true);
  if (!p3.ok) return;
  assert.equal(p3.repos.length, 1);
  assert.equal(p3.has_more, false);
});

test("listarReposDeGithub ignora repos archivados", async () => {
  process.env.QA_GITHUB_ALLOWED_OWNERS = "bart";
  mockFetch({
    "https://api.github.com/user/repos": () =>
      new Response(JSON.stringify([
        { name: "activo", full_name: "bart/activo", owner: { login: "bart" }, html_url: "https://github.com/bart/activo", default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
        { name: "viejo", full_name: "bart/viejo", owner: { login: "bart" }, html_url: "https://github.com/bart/viejo", default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: true, description: null },
      ]), { status: 200 }),
  });
  const out = await listarReposDeGithub({});
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.repos.length, 1);
  assert.equal(out.repos[0]?.name, "activo");
});

test("verificarRepoAutorizado rechaza owner fuera de la allowlist", async () => {
  process.env.QA_GITHUB_ALLOWED_OWNERS = "bart";
  mockFetch({});
  const meta = await verificarRepoAutorizado("https://github.com/attacker/evil");
  assert.equal(meta, null);
});

test("verificarRepoAutorizado acepta owner válido y verifica con GitHub", async () => {
  process.env.QA_GITHUB_ALLOWED_OWNERS = "bart";
  mockFetch({
    "https://api.github.com/repos/bart/neura-erp-roldan": () =>
      new Response(JSON.stringify({
        name: "neura-erp-roldan", full_name: "bart/neura-erp-roldan",
        owner: { login: "bart" }, html_url: "https://github.com/bart/neura-erp-roldan",
        default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null,
      }), { status: 200 }),
  });
  const meta = await verificarRepoAutorizado("https://github.com/bart/neura-erp-roldan");
  assert.ok(meta);
  assert.equal(meta?.default_branch, "main");
});

test("verificarRepoAutorizado devuelve null si GitHub responde 404", async () => {
  process.env.QA_GITHUB_ALLOWED_OWNERS = "bart";
  mockFetch({
    "https://api.github.com/repos/bart/no-existe": () =>
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
  });
  const meta = await verificarRepoAutorizado("https://github.com/bart/no-existe");
  assert.equal(meta, null);
});

test("listarReposDeGithub usa cache en segunda llamada", async () => {
  process.env.QA_GITHUB_ALLOWED_OWNERS = "bart";
  let hits = 0;
  mockFetch({
    "https://api.github.com/user/repos": () => {
      hits++;
      return new Response(JSON.stringify([
        { name: "r", full_name: "bart/r", owner: { login: "bart" }, html_url: "https://github.com/bart/r", default_branch: "main", private: false, updated_at: "2026-01-01T00:00:00Z", archived: false, description: null },
      ]), { status: 200 });
    },
  });
  await listarReposDeGithub({});
  await listarReposDeGithub({});
  assert.equal(hits, 1);
});
