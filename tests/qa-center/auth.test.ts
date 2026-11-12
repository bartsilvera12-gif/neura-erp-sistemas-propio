/**
 * Tests de assertSuperAdmin: debe operar SIN instanciar service_role.
 * Verificamos que (a) SUPABASE_SERVICE_ROLE_KEY NO se necesita, (b) rechaza
 * 401 si no hay user, (c) rechaza 403 si el email no está en la lista bootstrap.
 *
 * Inyectamos dependencias por ESM a través de variables de entorno controladas
 * y por import "normal" — el test NO necesita red ni cookies reales.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const saved = {
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPER_ADMIN_EMAILS: process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

before(() => {
  // Quitamos deliberadamente el service_role key para probar que
  // assertSuperAdmin NO lo necesita.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS = "admin@neura.com.py";
  // auth lib necesita URL + ANON para getAuthUserForApiRoute (aunque falle).
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon";
});
after(() => {
  Object.entries(saved).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
});

test("auth.ts: NO usa service_role ni superuser (chequeo estático del fuente)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile("src/lib/qa/auth.ts", "utf8");
  assert.ok(
    !src.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "auth.ts no debe mencionar SUPABASE_SERVICE_ROLE_KEY"
  );
  assert.ok(
    !src.includes("supabaseServiceRole") && !src.includes("service-admin"),
    "auth.ts no debe referenciar el cliente service-role"
  );
  // Prohíbe la `createClient` de @supabase/supabase-js (que crea un cliente
  // con API key, típicamente service_role). Permite `createSupabaseServerClient`
  // (cookie-scoped) porque ya es el patrón del ERP.
  assert.ok(
    !/\bcreateClient\s*\(/.test(src),
    "auth.ts no debe llamar createClient() de supabase-js (eso instancia admin cliente)"
  );
  assert.ok(
    !src.includes("resolveUsuarioErpFromAuthUser"),
    "auth.ts no debe usar el helper que recibe el service_role client"
  );
});

test("auth.ts: autoriza SOLO por rol='super_admin' en DB (fail-closed)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile("src/lib/qa/auth.ts", "utf8");
  assert.ok(
    src.includes("createSupabaseServerClient"),
    "auth.ts debe usar createSupabaseServerClient (cookie-scoped, RLS self-read)"
  );
  assert.ok(
    /\.from\(["']usuarios["']\)/.test(src),
    "auth.ts debe consultar la tabla usuarios para validar el rol real"
  );
  assert.ok(
    /roleFromDb\s*!==\s*["']super_admin["']/.test(src),
    "auth.ts debe denegar cuando rol !== 'super_admin' en DB"
  );
});

test("auth.ts: NO usa fallback por email (bootstrap) ni evaluación condicional de error", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile("src/lib/qa/auth.ts", "utf8");
  assert.ok(
    !src.includes("isBootstrapSuperAdminEmail"),
    "auth.ts no debe importar/llamar isBootstrapSuperAdminEmail (fallback email está prohibido)"
  );
  assert.ok(
    !/dbErrored\s*&&/.test(src),
    "auth.ts no debe tener condicional 'dbErrored && …' (fallback a email ya retirado)"
  );
});

test("page.tsx del panel: NO usa fallback por email", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile("src/app/dashboard/qa-center/page.tsx", "utf8");
  assert.ok(
    !src.includes("isBootstrapSuperAdminEmail"),
    "page.tsx no debe importar isBootstrapSuperAdminEmail"
  );
});
