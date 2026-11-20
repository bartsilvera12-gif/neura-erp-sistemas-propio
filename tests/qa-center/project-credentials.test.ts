/**
 * Tests de project-credentials: cifrado, máscara, redactCred.
 *
 * Usamos un PgLike fake en memoria con pgp_sym_encrypt/decrypt simulado por
 * JSON.stringify (no criptográfico — solo verifica la forma del flujo).
 * El cifrado real se testea end-to-end contra Postgres en un entorno DBA.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  upsertCredencial,
  listarCredencialesPorProyecto,
  desactivarCredencial,
  obtenerCredencialesParaRunner,
  redactCred,
  CredentialsConfigError,
  type PgLike,
} from "../../src/lib/qa/project-credentials";

const KEY = "x".repeat(40);

/**
 * Fake PgLike que emula el SQL con `extensions.pgp_sym_encrypt/decrypt`.
 * Store en memoria: Map<id, row>.
 */
function makeFakePg(): PgLike & { _store: Map<string, Record<string, unknown>> } {
  const store = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const encrypt = (plain: string, _key: string): string => `ENC::${plain}`;
  const decrypt = (ct: string, _key: string): string => ct.replace(/^ENC::/, "");

  const query = async (sql: string, args: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> => {
    const s = sql.replace(/\s+/g, " ").trim();

    // upsert
    if (s.startsWith("INSERT INTO qa_center.project_credentials")) {
      const [project_id, label, rol, payloadJson, key, created_by] = args as [
        string, string, string, string, string, string | null
      ];
      // ON CONFLICT: busca por (project_id, label)
      const existing = [...store.values()].find(
        (r) => r.project_id === project_id && r.label === label
      );
      if (existing) {
        existing.rol = rol;
        existing.payload_cifrado = encrypt(payloadJson, key);
        existing.active = true;
        existing.updated_at = new Date();
        return {
          rows: [
            {
              id: existing.id,
              label,
              rol,
              active: true,
              created_at: existing.created_at,
              last_used_at: existing.last_used_at ?? null,
              updated_at: existing.updated_at,
            },
          ],
        };
      }
      const id = `id-${++seq}`;
      const now = new Date();
      store.set(id, {
        id,
        project_id,
        label,
        rol,
        payload_cifrado: encrypt(payloadJson, key),
        active: true,
        created_at: now,
        created_by,
        last_used_at: null,
        updated_at: now,
      });
      return {
        rows: [{ id, label, rol, active: true, created_at: now, last_used_at: null, updated_at: now }],
      };
    }

    // listar
    if (s.startsWith("SELECT id, label, rol, active")) {
      const [project_id, key] = args as [string, string];
      const rows = [...store.values()]
        .filter((r) => r.project_id === project_id)
        .map((r) => ({
          id: r.id,
          label: r.label,
          rol: r.rol,
          active: r.active,
          created_at: r.created_at,
          last_used_at: r.last_used_at,
          updated_at: r.updated_at,
          payload_text: r.active ? decrypt(r.payload_cifrado as string, key) : null,
        }));
      return { rows };
    }

    // desactivar
    if (s.startsWith("UPDATE qa_center.project_credentials SET active = false")) {
      const [id, actor] = args as [string, string | null];
      const row = store.get(id);
      if (!row || row.active !== true) return { rows: [] };
      row.active = false;
      row.desactivada_at = new Date();
      row.desactivada_por = actor;
      row.updated_at = new Date();
      return { rows: [{ id }] };
    }

    // runner fetch
    if (s.startsWith("WITH act AS")) {
      const [project_slug, key] = args as [string, string];
      // Fake: match todo activo (en tests no modelamos joins)
      void project_slug;
      const rows = [...store.values()]
        .filter((r) => r.active === true)
        .map((r) => ({
          label: r.label,
          rol: r.rol,
          payload_text: decrypt(r.payload_cifrado as string, key),
        }));
      // Actualiza last_used_at (side effect)
      for (const r of store.values()) if (r.active) r.last_used_at = new Date();
      return { rows };
    }

    throw new Error(`fake pg: SQL no reconocido: ${s.slice(0, 80)}`);
  };

  return Object.assign({ query }, { _store: store });
}

test("upsert + list: devuelve máscara sin payload", async () => {
  process.env.QA_CREDENTIALS_ENC_KEY = KEY;
  const pg = makeFakePg();
  const mask = await upsertCredencial(pg, {
    project_id: "p1",
    label: "qa_lectura",
    rol: "lectura_autenticada",
    payload: { email: "qa@acme.com", password: "s3cret!" },
    created_by: "u1",
  });
  assert.equal(mask.email_mascara.includes("@"), true);
  assert.notEqual(mask.email_mascara, "qa@acme.com"); // no plaintext
  assert.equal(mask.password_mascara, "•••••••");
  assert.equal(mask.rol, "lectura_autenticada");

  const list = await listarCredencialesPorProyecto(pg, "p1");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.email_mascara.includes("qa@acme.com"), false);
});

test("redactCred nunca deja email/password", () => {
  const safe = redactCred({ email: "a@b.com", password: "x", other: 1 });
  assert.equal(safe.email, "[REDACTED]");
  assert.equal(safe.password, "[REDACTED]");
  assert.equal(safe.other, 1);
});

test("upsert de la misma label actualiza, no crea nueva fila", async () => {
  process.env.QA_CREDENTIALS_ENC_KEY = KEY;
  const pg = makeFakePg();
  await upsertCredencial(pg, {
    project_id: "p1",
    label: "qa_lectura",
    rol: "lectura_autenticada",
    payload: { email: "a@acme.com", password: "pw1" },
    created_by: "u1",
  });
  await upsertCredencial(pg, {
    project_id: "p1",
    label: "qa_lectura",
    rol: "sandbox_interactivo",
    payload: { email: "b@acme.com", password: "pw2" },
    created_by: "u1",
  });
  const list = await listarCredencialesPorProyecto(pg, "p1");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.rol, "sandbox_interactivo");
});

test("desactivar: active=false + desactivada_por queda registrado", async () => {
  process.env.QA_CREDENTIALS_ENC_KEY = KEY;
  const pg = makeFakePg();
  const m = await upsertCredencial(pg, {
    project_id: "p1",
    label: "qa_lectura",
    rol: "lectura_autenticada",
    payload: { email: "a@acme.com", password: "pw1" },
    created_by: "u1",
  });
  const ok = await desactivarCredencial(pg, m.id, "u2");
  assert.equal(ok, true);
  const row = pg._store.get(m.id)!;
  assert.equal(row.active, false);
  assert.equal(row.desactivada_por, "u2");

  // Idempotencia: desactivar de nuevo retorna false (ya estaba inactiva)
  const dup = await desactivarCredencial(pg, m.id, "u3");
  assert.equal(dup, false);
});

test("obtenerCredencialesParaRunner devuelve solo activas con payload", async () => {
  process.env.QA_CREDENTIALS_ENC_KEY = KEY;
  const pg = makeFakePg();
  await upsertCredencial(pg, {
    project_id: "p1",
    label: "qa_lectura",
    rol: "lectura_autenticada",
    payload: { email: "qa@acme.com", password: "pw", notas: "soloread" },
    created_by: "u1",
  });
  const creds = await obtenerCredencialesParaRunner(pg, "slug-irrelevante-en-test");
  assert.equal(creds.length, 1);
  assert.equal(creds[0]!.email, "qa@acme.com");
  assert.equal(creds[0]!.password, "pw");
  assert.equal(creds[0]!.notas, "soloread");
});

test("si QA_CREDENTIALS_ENC_KEY falta o es corta → CredentialsConfigError", async () => {
  process.env.QA_CREDENTIALS_ENC_KEY = "short";
  const pg = makeFakePg();
  await assert.rejects(
    upsertCredencial(pg, {
      project_id: "p1",
      label: "qa",
      rol: "lectura_autenticada",
      payload: { email: "a@a.com", password: "pw" },
      created_by: "u1",
    }),
    CredentialsConfigError
  );
});
