-- =============================================================================
-- QA: rondas de revisión + hilo interno PM/QA
--
-- NECESIDAD
--   1) Las observaciones no tienen a qué revisión pertenecen. QA revisa, el
--      técnico corrige, QA vuelve a revisar: hoy todo eso queda en una lista
--      plana y no se puede leer "primera revisión: 5 cambios, segunda: 3".
--   2) Los comentarios sólo distinguen 'qa' y 'tecnico', los dos visibles para
--      Desarrollo. Falta un canal privado entre Project Manager y QA.
--
-- CAMBIO (aditivo, sin downtime)
--   - `proyecto_qa_observaciones.ronda` smallint NOT NULL DEFAULT 1. Todo lo
--     que ya existe queda en la ronda 1, que es exactamente lo que fue.
--   - El CHECK de `proyecto_qa_observacion_comentarios.origen` acepta además
--     'interno'. Ese valor NUNCA se le envía a Desarrollo: el filtro vive en la
--     API, no en la UI, para que no dependa de que el cliente se porte bien.
--
-- DESCUBRIMIENTO DE SCHEMAS
--   Por presencia de la tabla, no por lista fija de nombres.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  -- ---------------------------------------------------------------------
  -- 1) Ronda de revisión en las observaciones.
  -- ---------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_qa_observaciones' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;

    EXECUTE format(
      'ALTER TABLE %I.proyecto_qa_observaciones
         ADD COLUMN IF NOT EXISTS ronda smallint NOT NULL DEFAULT 1',
      sch
    );

    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.proyecto_qa_observaciones
           DROP CONSTRAINT IF EXISTS chk_pqo_ronda',
        sch
      );
      EXECUTE format(
        'ALTER TABLE %I.proyecto_qa_observaciones
           ADD CONSTRAINT chk_pqo_ronda CHECK (ronda >= 1)',
        sch
      );
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Schema %: chk_pqo_ronda omitido (tabla de otro rol).', sch;
    END;

    -- El board agrupa por ronda dentro de un proyecto.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_pqo_proyecto_ronda
         ON %I.proyecto_qa_observaciones (empresa_id, proyecto_id, ronda)',
      sch
    );

    RAISE NOTICE 'Schema %: ronda lista en proyecto_qa_observaciones.', sch;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 2) 'interno' como origen válido de comentario.
  -- ---------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_qa_observacion_comentarios' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    BEGIN
      -- Repara de paso los schemas donde la columna nunca llegó a crearse: la
      -- migración que la introdujo (20260819200000) no corrió en todos, así que
      -- acá se agrega si falta en vez de fallar con "column origen does not
      -- exist". Los comentarios que ya existan quedan como 'qa', que es lo que
      -- eran antes de que hubiera dos hilos.
      EXECUTE format(
        $sql$
        ALTER TABLE %I.proyecto_qa_observacion_comentarios
          ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'qa'
        $sql$,
        sch
      );

      EXECUTE format(
        'ALTER TABLE %I.proyecto_qa_observacion_comentarios
           DROP CONSTRAINT IF EXISTS chk_pqoc_origen',
        sch
      );
      EXECUTE format(
        $sql$
        ALTER TABLE %I.proyecto_qa_observacion_comentarios
          ADD CONSTRAINT chk_pqoc_origen
          CHECK (origen IN ('qa', 'tecnico', 'interno'))
        $sql$,
        sch
      );
      RAISE NOTICE 'Schema %: origen de comentarios acepta ''interno''.', sch;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Schema %: chk_pqoc_origen omitido (tabla de otro rol).', sch;
    END;
  END LOOP;
END $$;
