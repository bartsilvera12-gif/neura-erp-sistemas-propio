-- Progreso en vivo del run: el runner emite eventos por módulo/submódulo/acción
-- y la UI del panel los pinta en un timeline con polling cada 2s.
-- No reemplaza a results ni al informe final: es el stream de lo que el agente
-- está haciendo mientras corre.

CREATE TABLE IF NOT EXISTS qa_center.run_events (
  id             bigserial PRIMARY KEY,
  run_id         uuid NOT NULL REFERENCES qa_center.runs(id) ON DELETE CASCADE,
  ts             timestamptz NOT NULL DEFAULT now(),
  fase           text NOT NULL,
  modulo         text,
  submodulo      text,
  accion         text,
  estado         text NOT NULL DEFAULT 'info',
  mensaje        text,
  evidence_path  text,
  payload        jsonb
);

-- Índice que soporta el polling "?since=<ts>" de la UI: últimos eventos por run.
CREATE INDEX IF NOT EXISTS idx_qa_run_events_run_ts
  ON qa_center.run_events(run_id, ts DESC);

COMMENT ON TABLE qa_center.run_events IS
  'Timeline en vivo del agente QA: módulo/submódulo/acción/estado por tick. Polling-friendly.';
COMMENT ON COLUMN qa_center.run_events.fase IS
  'discovery | comprension | spec_gen | spec_executing | informe | visual';
COMMENT ON COLUMN qa_center.run_events.estado IS
  'info | started | ok | fail | skipped | blocked | warn';
COMMENT ON COLUMN qa_center.run_events.evidence_path IS
  'Path relativo al evidence store (screenshot, trace) — opcional en MVP.';

GRANT SELECT, INSERT ON qa_center.run_events TO qa_center_api;
GRANT USAGE, SELECT ON SEQUENCE qa_center.run_events_id_seq TO qa_center_api;
