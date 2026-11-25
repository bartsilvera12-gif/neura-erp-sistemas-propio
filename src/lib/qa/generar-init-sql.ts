/**
 * Generador programático del init.sql para una sesión QA.
 * Usa la misma lógica del script `scripts/provision-qa-sandbox/dump-schema-ddl.cjs`
 * (CREATE TABLE expandido, FKs re-apuntadas, funciones/triggers/policies
 * renombradas al schema QA) pero ejecutable como librería.
 *
 * NUNCA produce DDL con `LIKE source_schema.table` (ese fue el bug que
 * resolvemos acá). Siempre emite CREATE TABLE con columnas expandidas.
 */

import type { Client } from "pg";

export type GenerarInitOpts = { sourceSchema: string; qaSchema: string };

export async function generarInitSql(client: Client, opts: GenerarInitOpts): Promise<string> {
  const { sourceSchema: SRC, qaSchema: QA } = opts;
  const ident = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const rewriteSchema = (sql: string) => sql.replace(new RegExp("\\b" + SRC + "\\.", "g"), QA + ".");

  const out: string[] = [];
  const log = (s: string) => out.push(s);

  log(`-- NEURA QA init.sql · source=${SRC} → qa=${QA} · ${new Date().toISOString()}`);
  log("BEGIN;");

  // Pre-check de identidad: aborta si ya existe el schema source en esta DB
  log(`DO $init$
BEGIN
  IF current_database() LIKE '%production%' THEN
    RAISE EXCEPTION 'INIT ABORTADO: parece ser una DB productiva (%)', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='${SRC}') THEN
    RAISE EXCEPTION 'INIT ABORTADO: existe schema "${SRC}" — no es el Postgres QA aislado';
  END IF;
END$init$;`);

  log(`CREATE SCHEMA IF NOT EXISTS ${ident(QA)};`);
  log(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  log(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  log(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  log(`CREATE EXTENSION IF NOT EXISTS citext;`);
  log(`CREATE EXTENSION IF NOT EXISTS unaccent;`);

  // Schema auth mínimo para que FKs funcionen sin GoTrue
  log(`CREATE SCHEMA IF NOT EXISTS auth;`);
  log(`CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);`);
  log(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid $$ LANGUAGE sql STABLE;`);
  log(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$ SELECT COALESCE(current_setting('request.jwt.claim.role', true),'anon') $$ LANGUAGE sql STABLE;`);

  // ENUMs
  const tipos = await client.query(
    `SELECT t.typname, (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
       FROM pg_enum e WHERE e.enumtypid=t.oid) AS labels
     FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
     WHERE n.nspname=$1 AND t.typtype='e' ORDER BY t.typname`,
    [SRC]
  );
  for (const r of tipos.rows) {
    const labels = (r.labels as string[]).map((l) => `'${l.replace(/'/g, "''")}'`).join(",");
    log(`CREATE TYPE ${ident(QA)}.${ident(r.typname)} AS ENUM (${labels});`);
  }

  // SEQUENCES — tienen que existir ANTES de las tablas porque los DEFAULT
  // nextval('<qa>.<seq>_id_seq') se evalúan al crear la tabla. Sin esto
  // falla con 'relation ... does not exist'.
  const seqs = await client.query(
    `SELECT c.relname AS seqname,
            s.seqtypid::regtype::text AS seq_type,
            s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle
     FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_sequence s ON s.seqrelid=c.oid
     WHERE c.relkind='S' AND n.nspname=$1
     ORDER BY c.relname`,
    [SRC]
  );
  for (const r of seqs.rows) {
    const parts = [
      `CREATE SEQUENCE IF NOT EXISTS ${ident(QA)}.${ident(r.seqname as string)}`,
      `AS ${r.seq_type as string}`,
      `INCREMENT BY ${r.seqincrement}`,
      `MINVALUE ${r.seqmin}`,
      `MAXVALUE ${r.seqmax}`,
      `START WITH ${r.seqstart}`,
      `CACHE ${r.seqcache}`,
      r.seqcycle ? "CYCLE" : "NO CYCLE",
    ];
    log(parts.join(" ") + ";");
  }

  // Tablas (CREATE TABLE expandido)
  const tabs = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename`,
    [SRC]
  );
  for (const r of tabs.rows) {
    log(await construirCreateTable(client, SRC, r.tablename, QA));
  }

  // SEQUENCE OWNED BY (vincula la secuencia a la columna para que DROP
  // TABLE borre la secuencia). Va después de las tablas porque la columna
  // tiene que existir.
  const owned = await client.query(
    `SELECT s.relname AS seqname, t.relname AS tablename, a.attname AS colname
     FROM pg_class s
     JOIN pg_namespace ns ON ns.oid=s.relnamespace
     JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass
     JOIN pg_class t ON t.oid=d.refobjid
     JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
     WHERE s.relkind='S' AND ns.nspname=$1
     ORDER BY s.relname`,
    [SRC]
  );
  for (const r of owned.rows) {
    log(`ALTER SEQUENCE ${ident(QA)}.${ident(r.seqname as string)} OWNED BY ${ident(QA)}.${ident(r.tablename as string)}.${ident(r.colname as string)};`);
  }

  // FKs
  const fks = await client.query(
    `SELECT c.conname, src.relname AS src_table,
            pg_get_constraintdef(c.oid) AS def, nref.nspname AS ref_schema
     FROM pg_constraint c
     JOIN pg_class src ON src.oid=c.conrelid
     JOIN pg_namespace nsrc ON nsrc.oid=src.relnamespace
     JOIN pg_class ref ON ref.oid=c.confrelid
     JOIN pg_namespace nref ON nref.oid=ref.relnamespace
     WHERE c.contype='f' AND nsrc.nspname=$1
     ORDER BY src.relname, c.conname`,
    [SRC]
  );
  for (const r of fks.rows) {
    let def = r.def as string;
    if (r.ref_schema === SRC) {
      def = def.replace(new RegExp("REFERENCES\\s+" + SRC + "\\.", "i"), `REFERENCES ${QA}.`);
    } else if (r.ref_schema !== "auth" && r.ref_schema !== "public") {
      log(`-- SKIP FK ${r.src_table}.${r.conname} → ${r.ref_schema}`);
      continue;
    }
    log(`ALTER TABLE ${ident(QA)}.${ident(r.src_table)} ADD CONSTRAINT ${ident(r.conname)} ${def};`);
  }

  // Funciones
  const fx = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname=$1 ORDER BY p.proname`,
    [SRC]
  );
  for (const r of fx.rows) {
    log(rewriteSchema(r.def as string) + ";");
  }

  // Triggers
  const trs = await client.query(
    `SELECT pg_get_triggerdef(t.oid) AS def
     FROM pg_trigger t
     JOIN pg_class rel ON rel.oid=t.tgrelid
     JOIN pg_namespace n ON n.oid=rel.relnamespace
     WHERE n.nspname=$1 AND NOT t.tgisinternal
     ORDER BY t.tgname`,
    [SRC]
  );
  for (const r of trs.rows) {
    log(rewriteSchema(r.def as string) + ";");
  }

  // Seed mínimo: 1 usuario QA en auth.users + referencia en usuarios (si existe)
  log(`INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-4000-8000-000000000001', 'qa.sandbox@fixture.local',
        crypt('fixture-sandbox-2026', gen_salt('bf', 10)), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"role":"admin","qa_sandbox":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;`);

  log(`COMMIT;`);

  return out.join("\n");
}

async function construirCreateTable(client: Client, srcSchema: string, tabla: string, qaSchema: string): Promise<string> {
  const cols = await client.query(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type_full,
            NOT a.attnotnull AS nullable,
            pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
            a.attidentity AS identity,
            a.attgenerated AS generated
     FROM pg_attribute a
     LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
     WHERE a.attrelid = (($1||'.'||$2)::regclass)
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [srcSchema, tabla]
  );
  const rewrite = (s: string) => s.replace(new RegExp("\\b" + srcSchema + "\\.", "g"), qaSchema + ".");
  const colDefs = cols.rows.map((c: Record<string, unknown>) => {
    let def = `  "${c.name as string}" ${rewrite(c.type_full as string)}`;
    // attgenerated = 's' → GENERATED ALWAYS AS (expr) STORED (columna
    // computada). En pg_attrdef la expresión se almacena igual que un
    // DEFAULT, pero no es un DEFAULT real: ponerla como "DEFAULT expr"
    // rompe con "cannot use column reference in DEFAULT expression".
    // Hay que emitirla con la sintaxis GENERATED ... STORED.
    if (c.generated === "s" && c.default_expr) {
      def += ` GENERATED ALWAYS AS (${rewrite(c.default_expr as string)}) STORED`;
    } else if (c.default_expr) {
      def += ` DEFAULT ${rewrite(c.default_expr as string)}`;
    }
    if (c.identity === "a") def += " GENERATED ALWAYS AS IDENTITY";
    else if (c.identity === "d") def += " GENERATED BY DEFAULT AS IDENTITY";
    if (!(c.nullable as boolean)) def += " NOT NULL";
    return def;
  });
  const cons = await client.query(
    `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid=con.conrelid
     JOIN pg_namespace n ON n.oid=rel.relnamespace
     WHERE n.nspname=$1 AND rel.relname=$2 AND con.contype IN ('p','u','c','x')
     ORDER BY con.conname`,
    [srcSchema, tabla]
  );
  const consDefs = cons.rows.map((c: Record<string, unknown>) =>
    `  CONSTRAINT "${c.conname as string}" ${rewrite(c.def as string)}`
  );
  const inner = [...colDefs, ...consDefs].join(",\n");
  return `CREATE TABLE IF NOT EXISTS "${qaSchema}"."${tabla}" (\n${inner}\n);`;
}
