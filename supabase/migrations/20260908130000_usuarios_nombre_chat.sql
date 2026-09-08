-- =============================================================================
-- Nombre para mostrar en el chat
--
-- Columna aparte y no un UPDATE sobre `usuarios.nombre`: ese nombre es el del
-- catálogo y aparece en proyectos, reportes y atribuciones. Que alguien se
-- ponga un apodo en el chat no puede reescribir cómo figura en un informe.
--
-- Vacío = se usa `nombre`, así que la columna no obliga a nada.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'usuarios' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    EXECUTE format('ALTER TABLE %I.usuarios ADD COLUMN IF NOT EXISTS nombre_chat text', sch);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
