-- =============================================================================
-- NEURA QA CENTER — rol dedicado para acceso Postgres directo.
--
-- ESTADO: PREPARADO, NO EJECUTADO. Requiere DBA y autorización explícita.
--
-- Diseño de seguridad (sujeto a las restricciones del usuario):
--   · NO usa BYPASSRLS. Se crean policies explícitas por tabla.
--   · NO configura DEFAULT PRIVILEGES. Las tablas futuras NO heredan permisos
--     automáticamente — cada nueva tabla requiere GRANT + policy explícita.
--   · El rol NO recibe USAGE sobre ningún otro schema. Verificación posterior
--     confirma aislamiento: `has_schema_privilege('qa_center_api', 'neura', 'USAGE') = false`.
--   · Sin herencia (NOINHERIT): pertenecer a grupos no otorga permisos efectivos
--     automáticamente.
--   · PUBLIC: la migración `qa_center` ya hace `REVOKE ALL ON SCHEMA qa_center FROM PUBLIC`.
--     Confirmado por el chequeo "anon/authenticated/PUBLIC sin privilegios" en V3.
--
-- Transacción única: si cualquier statement falla, rollback atómico.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout    = '5s';

BEGIN;

-- ─── 1) Crear el rol ─────────────────────────────────────────────────────────
-- Password: GENERAR CON `openssl rand -hex 32` y pasar por `psql -v pw="..."`.
-- Alternativa: ALTER ROLE ... PASSWORD en segunda etapa (fuera de este archivo).
CREATE ROLE qa_center_api
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS                           -- prohíbe bypass explícito
  CONNECTION LIMIT 10
  PASSWORD :'pw';                       -- :pw viene de `psql -v pw=<password>`

COMMENT ON ROLE qa_center_api IS
  'Rol de login SOLO para el backend QA Center. Scope limitado a qa_center.*';

-- ─── 2) USAGE sobre el schema (único; ningún otro) ───────────────────────────
GRANT USAGE ON SCHEMA qa_center TO qa_center_api;

-- ─── 3) GRANTs EXPLÍCITOS tabla por tabla (sin ALL IN SCHEMA, sin DEFAULT) ───
-- Nota: se listan las 9 tablas una por una para que una tabla futura NO reciba
-- permisos automáticos. Cualquier migración que agregue una tabla a qa_center
-- debe venir con su propio GRANT + policy — intencional.
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.projects       TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.suites         TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.runs           TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.results        TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.evidences      TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.findings       TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.runner_jobs    TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.runner_nonces  TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.audit_log      TO qa_center_api;

-- Secuencia bigserial del audit_log.
GRANT USAGE ON SEQUENCE qa_center.audit_log_id_seq TO qa_center_api;

-- ─── 4) EXECUTE acotado a funciones estrictamente necesarias ────────────────
-- touch_updated_at() es trigger y no requiere grant externo.
GRANT EXECUTE ON FUNCTION qa_center.claim_next_job(text)                    TO qa_center_api;
GRANT EXECUTE ON FUNCTION qa_center.reclaim_stale_jobs(interval)            TO qa_center_api;
GRANT EXECUTE ON FUNCTION qa_center.cleanup_runner_nonces(timestamptz)      TO qa_center_api;

-- ─── 5) RLS policies explícitas (reemplazan el bypass) ───────────────────────
-- Patrón: una policy FOR ALL por tabla, USING (true) WITH CHECK (true), TO qa_center_api.
-- `TO qa_center_api` hace que la policy SOLO aplique a sesiones de ese rol;
-- service_role y otros roles sin policy siguen sin acceso (deny by default).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'projects','suites','runs','results','evidences','findings',
    'runner_jobs','runner_nonces','audit_log'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY qa_center_api_crud ON qa_center.%I '
      'FOR ALL TO qa_center_api USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- VERIFICACIONES post-apply (ejecutar manualmente tras COMMIT):
-- =============================================================================
--
-- 5.1  Confirmar que qa_center_api NO tiene USAGE en otros schemas:
-- SELECT nspname, has_schema_privilege('qa_center_api', nspname, 'USAGE') AS usage
--   FROM pg_namespace
--  WHERE nspname NOT IN ('information_schema','pg_catalog','pg_toast')
--    AND has_schema_privilege('qa_center_api', nspname, 'USAGE')
--  ORDER BY nspname;
-- -- Debe listar SOLO qa_center.
--
-- 5.2  Confirmar que qa_center_api NO tiene privilegios en public, neura, zentra_erp:
-- SELECT grantee, privilege_type, table_schema, table_name
--   FROM information_schema.role_table_grants
--  WHERE grantee='qa_center_api'
--    AND table_schema NOT IN ('qa_center')
--  ORDER BY table_schema, table_name;
-- -- Debe devolver 0 filas.
--
-- 5.3  Confirmar policies activas:
-- SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--  WHERE schemaname='qa_center'
--  ORDER BY tablename;
-- -- Debe listar 9 filas, todas con policyname='qa_center_api_crud' y cmd='ALL'.
--
-- 5.4  Smoke funcional (SET ROLE):
-- SET ROLE qa_center_api;
-- SELECT * FROM qa_center.projects LIMIT 1;   -- OK: 0 filas
-- INSERT INTO qa_center.projects (slug, name, target_base_url, target_env)
--   VALUES ('ROLE-TEST','role test','http://127.0.0.1','local') RETURNING id;
-- DELETE FROM qa_center.projects WHERE slug='ROLE-TEST';
-- SELECT COUNT(*) FROM neura.usuarios;        -- FAIL: permission denied
-- RESET ROLE;
--
-- 5.5  Rollback del rol (si hiciera falta):
-- DROP ROLE qa_center_api;   -- CASCADE no aplica a roles; grants/policies se borran
--                            -- automáticamente al dropear el rol dueño.
-- =============================================================================
