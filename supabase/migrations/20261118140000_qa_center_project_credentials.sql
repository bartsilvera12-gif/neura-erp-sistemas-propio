-- =============================================================================
-- NEURA QA CENTER — Fase 1: credenciales QA por proyecto, cifradas.
--
-- Objetivo (pedido Fase 1):
--   "Configuración de credenciales QA independientes por proyecto, con
--    almacenamiento cifrado y sin exposición en logs."
--
-- Diseño:
--   · pgcrypto `pgp_sym_encrypt/decrypt` con una master key que vive FUERA de
--     la DB (env var `QA_CREDENTIALS_ENC_KEY`, mínimo 32 chars).
--   · La DB jamás ve la master key — se pasa como parámetro en cada call.
--   · `key_version` permite rotar la master key en el futuro re-encriptando.
--   · UNIQUE (project_id, label) → cada proyecto puede tener múltiples sets
--     (p. ej. "qa_lectura", "qa_admin", "qa_sandbox_writer") pero sin colisión.
--   · `last_used_at` se actualiza cada vez que el runner hace fetch — alerta
--     de credenciales huérfanas.
--   · `active` permite desactivar sin borrar — preserva historial.
--
-- Transacción única: cualquier fallo → rollback atómico.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout    = '5s';

BEGIN;

-- Extensión pgcrypto (idempotente)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Enum de rol — cada credencial declara para qué tipo de prueba sirve.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credencial_rol') THEN
    CREATE TYPE qa_center.credencial_rol AS ENUM (
      'lectura_anonima_no_aplica',    -- placeholder: lectura anónima no requiere credencial
      'lectura_autenticada',          -- usuario QA de solo-lectura
      'sandbox_interactivo',          -- usuario QA con permisos interactivos en sandbox
      'metrics_pg_monitor'            -- rol de Postgres para pg_exporter
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS qa_center.project_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES qa_center.projects(id) ON DELETE CASCADE,
  label             text NOT NULL,
  rol               qa_center.credencial_rol NOT NULL,
  -- Payload cifrado completo: {email, password, notas opcionales}.
  -- Usamos bytea en vez de text para que el ciphertext nunca se vea en psql
  -- por accidente como string imprimible.
  payload_cifrado   bytea NOT NULL,
  key_version       integer NOT NULL DEFAULT 1,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_credentials_label_slug CHECK (
    label ~ '^[a-z][a-z0-9_]{0,40}$'
  ),
  UNIQUE (project_id, label)
);

CREATE INDEX IF NOT EXISTS idx_project_credentials_project
  ON qa_center.project_credentials(project_id)
  WHERE active = true;

COMMENT ON TABLE qa_center.project_credentials IS
  'Credenciales QA por proyecto, cifradas con pgp_sym_encrypt. La master key vive en env QA_CREDENTIALS_ENC_KEY, nunca en la DB.';

COMMENT ON COLUMN qa_center.project_credentials.payload_cifrado IS
  'Ciphertext de {email, password, notas}. Descifrar solo con pgp_sym_decrypt(payload_cifrado, master_key).';

-- Trigger para mantener updated_at
CREATE OR REPLACE FUNCTION qa_center.touch_project_credentials() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_credentials_updated_at ON qa_center.project_credentials;
CREATE TRIGGER trg_project_credentials_updated_at
  BEFORE UPDATE ON qa_center.project_credentials
  FOR EACH ROW EXECUTE FUNCTION qa_center.touch_project_credentials();

-- RLS: mismo patrón que las otras tablas. qa_center_api con policy full CRUD.
ALTER TABLE qa_center.project_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qa_center_api_crud ON qa_center.project_credentials;
CREATE POLICY qa_center_api_crud
  ON qa_center.project_credentials
  FOR ALL TO qa_center_api
  USING (true) WITH CHECK (true);

-- El nuevo rol `qa_runner` (del trabajo anterior) NUNCA debe tener acceso
-- directo a esta tabla — solo lee credenciales via HMAC en el endpoint
-- `/api/qa/runner/credenciales/[slug]` del QA Center. Lo dejamos explícito:
REVOKE ALL ON qa_center.project_credentials FROM PUBLIC;
-- Nota: qa_runner (si existe ya) no recibe grant alguno sobre esta tabla.

COMMIT;

-- Reversión (manual):
--   DROP POLICY IF EXISTS qa_center_api_crud ON qa_center.project_credentials;
--   DROP TRIGGER IF EXISTS trg_project_credentials_updated_at ON qa_center.project_credentials;
--   DROP FUNCTION IF EXISTS qa_center.touch_project_credentials();
--   DROP TABLE IF EXISTS qa_center.project_credentials;
--   DROP TYPE IF EXISTS qa_center.credencial_rol;
