-- Informes humanos generados por IA a partir de los resultados del run.
-- Formato: por módulo → qué funcionó, qué falló, recomendación en español simple.
-- Aditivo. Sólo qa_center.

CREATE TABLE IF NOT EXISTS qa_center.informes_ia (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL UNIQUE REFERENCES qa_center.runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES qa_center.projects(id) ON DELETE CASCADE,
  resumen    text NOT NULL,
  modulos    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_informes_ia_project
  ON qa_center.informes_ia(project_id, created_at DESC);

COMMENT ON TABLE qa_center.informes_ia IS
  'Informe en español sencillo generado por IA sobre el run. Visible en panel.';
