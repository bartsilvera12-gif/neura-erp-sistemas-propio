-- =============================================================================
-- Menciones en los comentarios de proyecto
--
-- Guarda a quién se mencionó con @ en un comentario, como arreglo de ids de
-- usuario. Va en una columna y no derivado del texto porque el nombre puede
-- cambiar —o repetirse: en esta empresa hay dos Iván y dos Ayala— y una mención
-- tiene que seguir apuntando a la persona correcta.
--
-- Nullable y sin default: los comentarios que ya existen no mencionan a nadie.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_comentarios'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;
    EXECUTE format(
      'ALTER TABLE %I.proyecto_comentarios ADD COLUMN IF NOT EXISTS menciones jsonb',
      sch
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
