-- Control de costos LLM por run.
-- Aditivo. Sólo qa_center. Sin datos de clientes (sólo contadores + modelo).

CREATE TABLE IF NOT EXISTS qa_center.ai_usage (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                 uuid NOT NULL REFERENCES qa_center.runs(id) ON DELETE CASCADE,
  step                   text NOT NULL,                    -- comprension | spec_gen | informe
  model                  text NOT NULL,
  input_tokens           integer NOT NULL DEFAULT 0,
  output_tokens          integer NOT NULL DEFAULT 0,
  cache_read_tokens      integer NOT NULL DEFAULT 0,
  cache_creation_tokens  integer NOT NULL DEFAULT 0,
  cost_usd               numeric(10,6) NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'ok',       -- ok | skipped_budget | error
  error_message          text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_ai_usage_run
  ON qa_center.ai_usage(run_id, created_at);

COMMENT ON TABLE qa_center.ai_usage IS
  'Uso de la API de Claude por paso. El run aborta si el acumulado supera USD 2.';
