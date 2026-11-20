-- =============================================================================
-- NEURA QA CENTER — Fase 1.1: audit + grant USAGE en schema extensions.
--
-- Dos cosas:
--   1. Garantizar que el rol qa_center_api pueda invocar pgp_sym_encrypt /
--      pgp_sym_decrypt. En migraciones previas asumimos este GRANT; acá lo
--      aseguramos idempotente para que la Fase 1 funcione fuera de la caja.
--   2. Columna `desactivada_por` + `desactivada_at` en project_credentials
--      para tener auditoría de quién bajó una credencial. El flujo:
--        active = false   →   desactivada_at = now(), desactivada_por = user.
--      El panel registra el actor al llamar DELETE.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout    = '5s';

BEGIN;

-- 1) USAGE sobre extensions al qa_center_api (idempotente).
--    En Supabase self-host la extensión pgcrypto vive en el schema "extensions".
--    Sin USAGE sobre ese schema, invocar extensions.pgp_sym_encrypt tira
--    "permission denied for schema extensions".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qa_center_api') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA extensions TO qa_center_api';
      -- Grants explícitos sobre las funciones pgcrypto que usamos.
      EXECUTE 'GRANT EXECUTE ON FUNCTION extensions.pgp_sym_encrypt(text, text) TO qa_center_api';
      EXECUTE 'GRANT EXECUTE ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) TO qa_center_api';
      RAISE NOTICE 'GRANT USAGE extensions + EXECUTE pgp_sym_* aplicado a qa_center_api';
    ELSE
      RAISE WARNING 'schema extensions no existe — saltando grants';
    END IF;
  ELSE
    RAISE NOTICE 'rol qa_center_api aún no existe — correr qa-center-role.sql primero';
  END IF;
END$$;

-- 2) Columnas de auditoría en project_credentials.
ALTER TABLE qa_center.project_credentials
  ADD COLUMN IF NOT EXISTS desactivada_at  timestamptz,
  ADD COLUMN IF NOT EXISTS desactivada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN qa_center.project_credentials.desactivada_at IS
  'Timestamp de desactivación. Null si active=true o si nunca fue desactivada.';
COMMENT ON COLUMN qa_center.project_credentials.desactivada_por IS
  'Usuario que desactivó la credencial. Null si la desactivó un proceso de sistema.';

COMMIT;

-- Reversión:
--   ALTER TABLE qa_center.project_credentials DROP COLUMN IF EXISTS desactivada_at;
--   ALTER TABLE qa_center.project_credentials DROP COLUMN IF EXISTS desactivada_por;
