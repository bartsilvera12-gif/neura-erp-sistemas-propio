-- =============================================================================
-- Módulo Proyectos — Asignación de QA y pausa con motivo
--
-- Dos ejes nuevos sobre `proyectos`, ambos independientes de `etapa_desarrollo`:
--
-- 1) QA. La persona de QA revisa y prueba los proyectos, y su avance no es el
--    del programador: tiene su propio responsable, su propia etapa y su propio
--    contador. Por eso `qa_*` va aparte y no reusa `etapa_desarrollo`; un
--    proyecto puede estar "En Desarrollo" para el programador y en "Cambios"
--    para QA al mismo tiempo, y aparece en las dos tarjetas del tablero.
--
--      qa_responsable_id   quién revisa (NULL = sin QA asignado)
--      qa_asignado_at      cuándo se le asignó -> contador de días de QA
--      qa_etapa            cambios | revision_pre_entrega | finalizado
--      qa_etapa_at         cuándo entró a la etapa de QA actual
--
-- 2) Pausa. Se modela como bandera y NO como etapa para no perder en qué etapa
--    estaba el proyecto al pausarse: al despausar vuelve donde estaba. En el
--    tablero se muestra igual dentro del selector de etapa.
--
--      pausado_at          instante en que se pausó (NULL = corriendo)
--      pausa_motivo        por qué (obligatorio desde la UI; se ve en el
--                          tablero y viaja en el mensaje de WhatsApp)
--      pausa_acumulada_ms  tiempo total ya pausado en pausas cerradas
--
--    `pausa_acumulada_ms` existe para congelar el contador de días: los días
--    mostrados son (ahora - asignación) - pausa acumulada - pausa en curso. Sin
--    esto un proyecto parado tres semanas esperando al cliente se pinta en rojo
--    como si el programador estuviera atrasado.
--
-- Se replica en todo schema con `proyectos`. El schema de catálogo (usuarios)
-- se detecta dinámicamente (neura | zentra_erp | public).
-- =============================================================================

DO $$
DECLARE
  r        RECORD;
  sch      text;
  cat_sch  text;
BEGIN
  SELECT n.nspname INTO cat_sch
  FROM pg_class c2
  JOIN pg_namespace n ON n.oid = c2.relnamespace
  WHERE c2.relname = 'empresas'
    AND c2.relkind = 'r'
    AND EXISTS (
      SELECT 1
      FROM pg_class c3
      JOIN pg_namespace n2 ON n2.oid = c3.relnamespace
      WHERE c3.relname = 'usuarios'
        AND c3.relkind = 'r'
        AND n2.nspname = n.nspname
    )
  ORDER BY CASE n.nspname
    WHEN 'zentra_erp' THEN 1
    WHEN 'neura' THEN 2
    WHEN 'public' THEN 3
    ELSE 4
  END
  LIMIT 1;

  IF cat_sch IS NULL THEN
    RAISE EXCEPTION 'No se encontró schema de catálogo con tablas empresas + usuarios';
  END IF;

  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyectos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    -- 1) Columnas (idempotente).
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS qa_responsable_id uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL',
      sch, cat_sch
    );
    EXECUTE format('ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS qa_asignado_at timestamptz', sch);
    EXECUTE format('ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS qa_etapa text', sch);
    EXECUTE format('ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS qa_etapa_at timestamptz', sch);
    EXECUTE format('ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS pausado_at timestamptz', sch);
    EXECUTE format('ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS pausa_motivo text', sch);
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS pausa_acumulada_ms bigint NOT NULL DEFAULT 0',
      sch
    );

    -- 2) Dominio de la etapa de QA. NULL es válido: proyecto sin QA asignado.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'chk_proyectos_qa_etapa'
        AND conrelid = format('%I.proyectos', sch)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.proyectos
           ADD CONSTRAINT chk_proyectos_qa_etapa
           CHECK (qa_etapa IS NULL OR qa_etapa IN (''cambios'', ''revision_pre_entrega'', ''finalizado''))',
        sch
      );
    END IF;

    -- 3) Índice del bloque de QA del tablero.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyectos (empresa_id, qa_responsable_id, qa_etapa)',
      'ix_pr_qa_' || replace(md5(sch::text), '-', '_'), sch
    );
  END LOOP;

  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
