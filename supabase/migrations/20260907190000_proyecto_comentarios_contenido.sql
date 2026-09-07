-- =============================================================================
-- Comentarios de proyecto — un comentario puede no tener texto
--
-- `chk_proyecto_comentarios_texto_non_empty` exigía texto SIEMPRE. Eso era
-- correcto cuando un comentario era sólo texto, pero después se agregaron dos
-- formas de comentar que legítimamente no lo llevan:
--
--   · Reenviar un comentario con la nota vacía. El contenido es el original,
--     que viaja en `reenvio`; la nota de arriba es opcional por diseño.
--   · Adjuntar una imagen sin escribir nada.
--
-- La API ya permitía las dos y la base las rechazaba, así que el usuario veía
-- el error crudo del CHECK. Ninguna de las dos pudo funcionar nunca: no hay una
-- sola fila con `adjuntos` en la tabla.
--
-- El constraint no se elimina, se REEMPLAZA: un comentario sigue sin poder
-- quedar completamente vacío. Tiene que traer texto, un reenvío o un adjunto.
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

    -- Las columnas `reenvio` y `adjuntos` son de migraciones posteriores: si el
    -- schema todavía no las tiene, no hay nada que relajar.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch AND table_name = 'proyecto_comentarios' AND column_name = 'reenvio'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch AND table_name = 'proyecto_comentarios' AND column_name = 'adjuntos'
    );

    EXECUTE format(
      'ALTER TABLE %I.proyecto_comentarios
         DROP CONSTRAINT IF EXISTS chk_proyecto_comentarios_texto_non_empty',
      sch
    );

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'chk_proyecto_comentarios_contenido'
        AND conrelid = format('%I.proyecto_comentarios', sch)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.proyecto_comentarios
           ADD CONSTRAINT chk_proyecto_comentarios_contenido
           CHECK (
             length(trim(coalesce(comentario, ''''))) > 0
             OR reenvio IS NOT NULL
             OR (adjuntos IS NOT NULL AND jsonb_array_length(adjuntos) > 0)
           )',
        sch
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
