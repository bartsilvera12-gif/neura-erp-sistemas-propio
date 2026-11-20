-- =============================================================================
-- NEURA QA CENTER — ciclo de vida del proyecto (autorización + entrega).
-- Aditiva. No altera datos existentes (los proyectos quedan `en_desarrollo`).
-- NO EJECUTADA. Requiere autorización explícita antes de correr.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout    = '5s';

BEGIN;

-- 1) Enum de estado de entrega.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_estado_entrega') THEN
    CREATE TYPE qa_center.project_estado_entrega AS ENUM (
      'en_desarrollo',
      'en_qa',
      'entregado'
    );
  END IF;
END$$;

-- 2) Campos en qa_center.projects.
ALTER TABLE qa_center.projects
  ADD COLUMN IF NOT EXISTS estado_entrega qa_center.project_estado_entrega
    NOT NULL DEFAULT 'en_desarrollo',
  ADD COLUMN IF NOT EXISTS autorizacion_qa_hasta timestamptz;

-- 3) Tabla de autorizaciones (historial de cada renovación).
--    Las 3 declaraciones humanas quedan en `declaraciones` (jsonb) para
--    permitir auditoría sin romper schema si en el futuro se agregan más.
CREATE TABLE IF NOT EXISTS qa_center.project_autorizaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES qa_center.projects(id) ON DELETE CASCADE,
  usuario_id      uuid REFERENCES auth.users(id),
  declaraciones   jsonb NOT NULL,
  autorizado_hasta timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_project_autorizaciones_project
  ON qa_center.project_autorizaciones(project_id, created_at DESC);

-- 4) RLS: el rol qa_center_api ya tiene ALL privileges por policy existente;
--    agregamos política explícita sobre la nueva tabla con el mismo patrón.
ALTER TABLE qa_center.project_autorizaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qa_center_api_crud ON qa_center.project_autorizaciones;
CREATE POLICY qa_center_api_crud
  ON qa_center.project_autorizaciones
  FOR ALL TO qa_center_api
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.project_autorizaciones TO qa_center_api;

-- 5) Verificación.
DO $$
DECLARE
  n_proj integer;
BEGIN
  SELECT COUNT(*) INTO n_proj FROM qa_center.projects WHERE estado_entrega = 'en_desarrollo';
  RAISE NOTICE 'projects con estado_entrega=en_desarrollo (por default): %', n_proj;
END$$;

COMMIT;

-- Reversión (si hiciera falta):
--   DROP POLICY IF EXISTS qa_center_api_crud ON qa_center.project_autorizaciones;
--   DROP TABLE IF EXISTS qa_center.project_autorizaciones;
--   ALTER TABLE qa_center.projects DROP COLUMN IF EXISTS autorizacion_qa_hasta;
--   ALTER TABLE qa_center.projects DROP COLUMN IF EXISTS estado_entrega;
--   DROP TYPE IF EXISTS qa_center.project_estado_entrega;
