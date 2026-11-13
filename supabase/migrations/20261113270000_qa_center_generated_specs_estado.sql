-- Ciclo de ejecución para specs IA generados.
--   pending             → sanitizado, no ejecutado
--   executed_pass       → ejecutado, Playwright devolvió passed
--   executed_fail       → ejecutado, Playwright devolvió failed/timed_out
--   executed_error      → runner no pudo ejecutarlo (infra)
--   blocked_env_assert  → gate env-assert lo bloqueó (target no autoriza)
--   blocked_safety      → gate del catálogo lo bloqueó (safety_level no apto)
--
-- Aditivo. Sólo qa_center. Idempotente.

ALTER TABLE qa_center.generated_specs
  ADD COLUMN IF NOT EXISTS estado_ejecucion  text NOT NULL DEFAULT 'pending'
    CHECK (estado_ejecucion IN (
      'pending',
      'executed_pass',
      'executed_fail',
      'executed_error',
      'blocked_env_assert',
      'blocked_safety'
    )),
  ADD COLUMN IF NOT EXISTS last_run_id       uuid REFERENCES qa_center.runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_executed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_error        text;

CREATE INDEX IF NOT EXISTS idx_qa_genspecs_estado
  ON qa_center.generated_specs(codebase, estado_ejecucion);

COMMENT ON COLUMN qa_center.generated_specs.estado_ejecucion IS
  'Ciclo de ejecución del spec IA. "pending" = nunca corrido. El informe IA no puede declarar como aprobado nada que no esté en executed_pass.';
