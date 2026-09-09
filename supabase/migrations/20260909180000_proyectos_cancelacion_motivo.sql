-- =============================================================================
-- Motivo de cancelación del proyecto
--
-- Columna propia y no reutilizar `bloqueo_motivo`: un bloqueo es temporal y se
-- destraba, una cancelación es definitiva. Guardarlos en el mismo campo haría
-- que cancelar pisara el motivo del bloqueo que llevó hasta ahí — justo el dato
-- que después explica por qué se canceló.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyectos' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS cancelacion_motivo text', sch);
  END LOOP;
END $$;

-- Sin esto la API contesta 400 "could not find column in schema cache".
NOTIFY pgrst, 'reload schema';
