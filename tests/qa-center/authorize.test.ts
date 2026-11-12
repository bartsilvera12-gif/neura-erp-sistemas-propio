/**
 * Tests de resolveQaAccess (lógica de autorización del módulo).
 * Mockeamos un SupabaseClient con respuestas controladas por tabla/eq.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolveQaAccess } from "../../src/lib/qa/authorize";

const NEURA_ID = "9fd29108-4b0f-4faf-9eee-c509f6227d47";
const OTHER_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const MOD_ID   = "11111111-1111-4111-8111-111111111111";

type TblResp = { data: unknown; error: { message: string } | null };
type Tbl = Record<string, TblResp | ((filters: Record<string, unknown>) => TblResp)>;

function buildMock(tables: Record<string, Tbl>) {
  return {
    from(table: string) {
      const handlers = tables[table] ?? {};
      const filters: Record<string, unknown> = {};
      const builder = {
        select(_cols: string) { return builder; },
        eq(col: string, val: unknown) { filters[col] = val; return builder; },
        limit(_n: number) {
          const key = Object.values(filters).join("|");
          const resolver = handlers[key] ?? handlers["*"];
          const resp = typeof resolver === "function" ? resolver(filters) : (resolver as TblResp);
          return Promise.resolve(resp ?? { data: [], error: null });
        },
      };
      return builder;
    },
  } as unknown as Parameters<typeof resolveQaAccess>[0];
}

const saved = process.env.QA_NEURA_INTERNAL_COMPANY_ID;
before(() => { process.env.QA_NEURA_INTERNAL_COMPANY_ID = NEURA_ID; });
after(() => {
  if (saved === undefined) delete process.env.QA_NEURA_INTERNAL_COMPANY_ID;
  else process.env.QA_NEURA_INTERNAL_COMPANY_ID = saved;
});

test("config_missing: sin QA_NEURA_INTERNAL_COMPANY_ID → denegado", async () => {
  delete process.env.QA_NEURA_INTERNAL_COMPANY_ID;
  const sb = buildMock({ usuarios: { "x@a.com": { data: [], error: null } } });
  const d = await resolveQaAccess(sb, "x@a.com");
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "config_missing");
  process.env.QA_NEURA_INTERNAL_COMPANY_ID = NEURA_ID;
});

test("super_admin de cualquier empresa → OK sin requerir módulos", async () => {
  const sb = buildMock({
    usuarios: { "x@a.com": { data: [{ id: "u1", rol: "super_admin", empresa_id: OTHER_ID }], error: null } },
  });
  const d = await resolveQaAccess(sb, "x@a.com");
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.reason, "super_admin");
});

test("administrador en Neura CON asignación y módulo activo → OK", async () => {
  const sb = buildMock({
    usuarios: { "admin@n.com": { data: [{ id: "u1", rol: "administrador", empresa_id: NEURA_ID }], error: null } },
    empresas: { [NEURA_ID]: { data: [{ id: NEURA_ID, data_schema: "neura" }], error: null } },
    modulos: { "qa_center": { data: [{ id: MOD_ID }], error: null } },
    empresa_modulos: { "*": { data: [{ activo: true }], error: null } },
    usuario_modulos: { "*": { data: [{ id: "um1" }], error: null } },
  });
  const d = await resolveQaAccess(sb, "admin@n.com");
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.reason, "neura_qa_member");
});

test("administrador en Neura SIN asignación individual → denegado", async () => {
  const sb = buildMock({
    usuarios: { "admin@n.com": { data: [{ id: "u1", rol: "administrador", empresa_id: NEURA_ID }], error: null } },
    empresas: { [NEURA_ID]: { data: [{ id: NEURA_ID, data_schema: "neura" }], error: null } },
    modulos: { "qa_center": { data: [{ id: MOD_ID }], error: null } },
    empresa_modulos: { "*": { data: [{ activo: true }], error: null } },
    usuario_modulos: { "*": { data: [], error: null } },
  });
  const d = await resolveQaAccess(sb, "admin@n.com");
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "user_module_missing");
});

test("administrador de OTRA empresa (aunque tenga asignación) → denegado", async () => {
  const sb = buildMock({
    usuarios: { "admin@otra.com": { data: [{ id: "u1", rol: "administrador", empresa_id: OTHER_ID }], error: null } },
  });
  const d = await resolveQaAccess(sb, "admin@otra.com");
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "wrong_company");
});

test("empresa con UUID correcto pero data_schema distinto → denegado (validación doble)", async () => {
  const sb = buildMock({
    usuarios: { "x@n.com": { data: [{ id: "u1", rol: "administrador", empresa_id: NEURA_ID }], error: null } },
    empresas: { [NEURA_ID]: { data: [{ id: NEURA_ID, data_schema: "fake" }], error: null } },
  });
  const d = await resolveQaAccess(sb, "x@n.com");
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "wrong_company");
});

test("empresa Neura pero módulo NO activo → denegado", async () => {
  const sb = buildMock({
    usuarios: { "x@n.com": { data: [{ id: "u1", rol: "administrador", empresa_id: NEURA_ID }], error: null } },
    empresas: { [NEURA_ID]: { data: [{ id: NEURA_ID, data_schema: "neura" }], error: null } },
    modulos: { "qa_center": { data: [{ id: MOD_ID }], error: null } },
    empresa_modulos: { "*": { data: [], error: null } },
  });
  const d = await resolveQaAccess(sb, "x@n.com");
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "company_module_inactive");
});

test("módulo qa_center NO existe en el catálogo → denegado", async () => {
  const sb = buildMock({
    usuarios: { "x@n.com": { data: [{ id: "u1", rol: "administrador", empresa_id: NEURA_ID }], error: null } },
    empresas: { [NEURA_ID]: { data: [{ id: NEURA_ID, data_schema: "neura" }], error: null } },
    modulos: { "qa_center": { data: [], error: null } },
  });
  const d = await resolveQaAccess(sb, "x@n.com");
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "company_module_inactive");
});

test("usuario no existe en neura.usuarios → user_not_found", async () => {
  const sb = buildMock({ usuarios: { "unknown@x.com": { data: [], error: null } } });
  const d = await resolveQaAccess(sb, "unknown@x.com");
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "user_not_found");
});

test("DB error al leer usuarios → db_error (fail-closed)", async () => {
  const sb = buildMock({
    usuarios: { "x@n.com": { data: null, error: { message: "RLS denied" } } },
  });
  const d = await resolveQaAccess(sb, "x@n.com");
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.reason, "db_error");
});

test("rol 'usuario' común con todas las asignaciones correctas → OK", async () => {
  const sb = buildMock({
    usuarios: { "staff@n.com": { data: [{ id: "u1", rol: "usuario", empresa_id: NEURA_ID }], error: null } },
    empresas: { [NEURA_ID]: { data: [{ id: NEURA_ID, data_schema: "neura" }], error: null } },
    modulos: { "qa_center": { data: [{ id: MOD_ID }], error: null } },
    empresa_modulos: { "*": { data: [{ activo: true }], error: null } },
    usuario_modulos: { "*": { data: [{ id: "um1" }], error: null } },
  });
  const d = await resolveQaAccess(sb, "staff@n.com");
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.reason, "neura_qa_member");
});
