-- Specs Playwright generadas por IA y sanitizadas por el runner.
-- Fuente de verdad para reuso cross-ERP del mismo codebase.
-- Aditivo. Sólo qa_center.

DO $$ BEGIN
  CREATE TYPE qa_center.generated_spec_status AS ENUM (
    'validated', 'rejected', 'retired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS qa_center.generated_specs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codebase               text NOT NULL,
  modulo                 text NOT NULL,
  spec_file              text NOT NULL,
  spec_source            text NOT NULL,
  source_sanitized_sha256 text NOT NULL,
  invariante             text NOT NULL,
  severidad              text NOT NULL DEFAULT 'minor',
  requiere_sesion        boolean NOT NULL DEFAULT true,
  efecto                 text NOT NULL DEFAULT 'lectura_autenticada_estricta'
                           CHECK (efecto = 'lectura_autenticada_estricta'),
  status                 qa_center.generated_spec_status NOT NULL DEFAULT 'validated',
  rejection_reason       text,
  created_by_run_id      uuid REFERENCES qa_center.runs(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codebase, spec_file)
);
CREATE INDEX IF NOT EXISTS idx_qa_genspecs_codebase_status
  ON qa_center.generated_specs(codebase, status);

COMMENT ON TABLE qa_center.generated_specs IS
  'Specs generados por IA, validados por sanitizarSpecIA. Reutilizables cross-ERP.';
COMMENT ON COLUMN qa_center.generated_specs.efecto IS
  'Fijo en lectura_autenticada_estricta. La IA NUNCA puede promover a escritura.';
