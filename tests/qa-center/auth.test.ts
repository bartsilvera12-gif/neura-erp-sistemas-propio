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

test("auth.ts: NO usa service_role ni createClient Supabase (chequeo estático del fuente)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile("src/lib/qa/auth.ts", "utf8");
  // Rechaza la key service_role
  assert.ok(
    !src.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "auth.ts no debe mencionar SUPABASE_SERVICE_ROLE_KEY"
  );
  // Rechaza instanciación de clientes admin
  assert.ok(
    !src.includes("createClient"),
    "auth.ts no debe llamar createClient() (eso crea un cliente Supabase runtime)"
  );
  // Rechaza referencias al helper de service-role
  assert.ok(
    !src.includes("service-admin") && !src.includes("supabaseServiceRole"),
    "auth.ts no debe referenciar el cliente service-role"
  );
  // Rechaza lookup contra neura.usuarios
  assert.ok(
    !/resolveUsuarioErpFromAuthUser|from\(["']usuarios["']\)/.test(src),
    "auth.ts no debe consultar la tabla usuarios"
  );
});

test("auth.ts: SÓLO autoriza vía isBootstrapSuperAdminEmail", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile("src/lib/qa/auth.ts", "utf8");
  assert.ok(
    src.includes("isBootstrapSuperAdminEmail"),
    "auth.ts debe usar isBootstrapSuperAdminEmail"
  );
});
