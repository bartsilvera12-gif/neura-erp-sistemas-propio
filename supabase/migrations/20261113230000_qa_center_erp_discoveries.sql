-- Discovery: índice automático de módulos, endpoints y tablas descubiertos
-- por el runner al clonar un repo de ERP. Alimenta la fase de comprensión IA.
-- Aditivo. Sólo qa_center. No toca datos de clientes.

CREATE TABLE IF NOT EXISTS qa_center.erp_discoveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES qa_center.projects(id) ON DELETE CASCADE,
  run_id      uuid REFERENCES qa_center.runs(id) ON DELETE SET NULL,
  commit_sha  text,
  codebase    text,
  modulos     jsonb NOT NULL DEFAULT '[]'::jsonb,
  totales     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_discoveries_project
  ON qa_center.erp_discoveries(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_discoveries_codebase
  ON qa_center.erp_discoveries(codebase, created_at DESC);

COMMENT ON TABLE qa_center.erp_discoveries IS
  'Snapshots de módulos/endpoints/tablas descubiertos al clonar el repo del ERP.';
