-- =============================================================================
-- Marcador "Confirmación de solicitud del cliente" en archivos de proyecto
--
-- Al subir una imagen, se puede tildar que es la confirmación del cliente
-- (captura de WhatsApp, foto de un comprobante de acuerdo, etc.). Las marcadas
-- se muestran en su propia sección en la pestaña Archivos, separadas del resto
-- — es evidencia que se necesita encontrar rápido, no mezclada con logos y
-- capturas de referencia.
--
--   confirmacion_cliente   boolean, default false. Se fija al subir o se
--                          alterna después desde la ficha del archivo.
--
-- Se replica en todo schema con `proyecto_archivos`.
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
    WHERE c.relname = 'proyecto_archivos'
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
      'ALTER TABLE %I.proyecto_archivos ADD COLUMN IF NOT EXISTS confirmacion_cliente boolean NOT NULL DEFAULT false',
      sch
    );
    -- Índice parcial: la consulta típica es "traeme las marcadas de este
    -- proyecto", y son siempre una minoría de los archivos.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_archivos (proyecto_id) WHERE confirmacion_cliente',
      'ix_parch_confirmacion_' || replace(md5(sch::text), '-', '_'), sch
    );

    RAISE NOTICE 'Schema %: confirmacion_cliente lista en proyecto_archivos.', sch;
  END LOOP;
END $$;
