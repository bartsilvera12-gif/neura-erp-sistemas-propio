-- =============================================================================
-- Soporte: fase del ticket
--
-- Cada vez que QA pide cambios, el ticket vuelve a "En proceso" y suma una fase
-- (Fase 1, Fase 2, ...). Se completa la fase de los tickets existentes con la
-- cantidad de devoluciones de QA registradas en su historial.
--
-- Sólo el schema `neura`. Aditiva e idempotente.
-- =============================================================================

SET client_encoding = 'UTF8';

ALTER TABLE neura.soporte_tickets ADD COLUMN IF NOT EXISTS fase integer NOT NULL DEFAULT 1;

UPDATE neura.soporte_tickets t
SET fase = 1 + x.n
FROM (
  SELECT ticket_id, count(*)::int AS n
  FROM neura.soporte_ticket_historial
  WHERE tipo_evento = 'devolucion_qa'
  GROUP BY ticket_id
) x
WHERE x.ticket_id = t.id AND t.fase <> 1 + x.n;

NOTIFY pgrst, 'reload schema';
