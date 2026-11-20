-- Override por proyecto: habilita correr suites "authenticated_read_only"
-- aunque el target no exponga /api/qa/env-assert. Es responsabilidad del
-- admin del proyecto marcarlo. El runner lo honra sólo cuando el nivel
-- del run calculado desde el catálogo es authenticated_read_only.

ALTER TABLE qa_center.projects
  ADD COLUMN IF NOT EXISTS permite_lectura_sin_env_assert boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN qa_center.projects.permite_lectura_sin_env_assert IS
  'Admin del proyecto certifica que ya existe un usuario QA de SÓLO LECTURA en el ERP y autoriza que el runner ejecute la auditoría funcional sin consultar env-assert sobre el dominio productivo.';
