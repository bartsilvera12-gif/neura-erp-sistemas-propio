-- =============================================================================
-- Soporte: la fecha objetivo del ticket pasa a tener hora
--
-- En los errores vence a una hora concreta (SLA de 2, 5 u 8 horas laborales):
-- una fecha sola no alcanza. `fecha_objetivo` pasa de `date` a `timestamptz`.
-- Las fechas que ya había quedan al cierre de ese día (17:00, hora de Paraguay).
--
-- También se ajusta la función que crea el ticket desde la tipificación, que
-- convertía ese campo a `date` y perdería la hora.
--
-- Idempotente: sólo convierte donde la columna sigue siendo `date`. Las tablas
-- de soporte son chicas; el cambio de tipo es instantáneo.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

DO $$
DECLARE
  r   RECORD;
  def text;
BEGIN
  FOR r IN
    SELECT c.table_schema AS sch
    FROM information_schema.columns c
    WHERE c.table_name = 'soporte_tickets'
      AND c.column_name = 'fecha_objetivo'
      AND c.data_type = 'date'
    ORDER BY 1
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.soporte_tickets ALTER COLUMN fecha_objetivo TYPE timestamptz
         USING CASE WHEN fecha_objetivo IS NULL THEN NULL
                    ELSE (fecha_objetivo + time ''17:00'') AT TIME ZONE INTERVAL ''-03:00'' END',
      r.sch);
  END LOOP;

  FOR r IN
    SELECT p.oid, n.nspname AS sch
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'soporte_crear_ticket_desde_tipificacion'
  LOOP
    def := pg_get_functiondef(r.oid);
    CONTINUE WHEN position('''fecha_objetivo'', '''')::date' IN def) = 0;
    EXECUTE replace(def, '''fecha_objetivo'', '''')::date', '''fecha_objetivo'', '''')::timestamptz');
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
