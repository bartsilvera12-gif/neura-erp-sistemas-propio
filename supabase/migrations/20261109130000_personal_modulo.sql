-- =============================================================================
-- Gestión de Personal (RRHH) · Fase 1 — núcleo
-- -----------------------------------------------------------------------------
-- Ficha del funcionario: datos de cargo + incidencias + documentos.
--   · Amplía `usuarios` con datos de RRHH (código, cargo, modalidad, supervisor).
--   · `personal_incidencias`: llegadas tardías, amonestaciones, suspensiones,
--     ausencias justificadas, reconocimientos y observaciones del empleado.
--   · `personal_documentos`: documentos por empleado (contrato, CV, certificados…).
--
-- Tablas solo-API: RLS activa, sin políticas, GRANT solo a service_role (la API
-- usa el cliente de servicio). Aditiva e idempotente. Solo schema `neura`.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

-- ------------------------------------------------------------- usuarios (RRHH)
ALTER TABLE neura.usuarios ADD COLUMN IF NOT EXISTS codigo_empleado text;
ALTER TABLE neura.usuarios ADD COLUMN IF NOT EXISTS cargo text;
ALTER TABLE neura.usuarios ADD COLUMN IF NOT EXISTS modalidad text;
ALTER TABLE neura.usuarios ADD COLUMN IF NOT EXISTS supervisor_id uuid REFERENCES neura.usuarios(id) ON DELETE SET NULL;

-- --------------------------------------------------------- personal_incidencias
CREATE TABLE IF NOT EXISTS neura.personal_incidencias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  usuario_id     uuid NOT NULL REFERENCES neura.usuarios(id) ON DELETE CASCADE,
  fecha          date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Asuncion')::date,
  tipo           text NOT NULL CHECK (tipo IN (
                   'llegada_tardia','amonestacion','suspension',
                   'ausencia_justificada','reconocimiento','observacion')),
  descripcion    text NOT NULL CHECK (length(btrim(descripcion)) > 0),
  estado         text NOT NULL DEFAULT 'finalizada'
                   CHECK (estado IN ('pendiente','en_proceso','finalizada','anulada')),
  registrado_por_id    uuid,
  registrado_por_label text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_personal_inc_usuario ON neura.personal_incidencias (empresa_id, usuario_id, fecha DESC);
CREATE INDEX IF NOT EXISTS ix_personal_inc_tipo ON neura.personal_incidencias (empresa_id, tipo);

ALTER TABLE neura.personal_incidencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON neura.personal_incidencias FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.personal_incidencias TO service_role;

-- ---------------------------------------------------------- personal_documentos
CREATE TABLE IF NOT EXISTS neura.personal_documentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  usuario_id     uuid NOT NULL REFERENCES neura.usuarios(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  storage_bucket text NOT NULL,
  storage_path   text NOT NULL,
  mime_type      text,
  size_bytes     bigint,
  subido_por     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_personal_doc_path UNIQUE (storage_bucket, storage_path)
);
CREATE INDEX IF NOT EXISTS ix_personal_doc_usuario ON neura.personal_documentos (empresa_id, usuario_id, created_at DESC);

ALTER TABLE neura.personal_documentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON neura.personal_documentos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.personal_documentos TO service_role;

NOTIFY pgrst, 'reload schema';
