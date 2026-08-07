-- =============================================================================
-- Módulo Proyectos — Etapa de desarrollo (tablero "Tareas del equipo")
--
-- Motivación: el equipo necesita una vista por programador con el avance real
-- de desarrollo, independiente del Kanban comercial (`proyecto_estados`, que es
-- configurable por empresa y tiene 13 columnas de pipeline).
--
-- Se agrega un eje propio y acotado sobre `proyectos`:
--   etapa_desarrollo      en_desarrollo | esqueleto_finalizado | qa | finalizado
--   etapa_desarrollo_at   cuándo entró a la etapa actual
--   etapa_finalizado_at   cuándo pasó a 'finalizado' (NULL si volvió atrás)
--   tecnico_asignado_at   cuándo se le asignó el técnico actual -> contador de días
--
-- Backfill:
--   * tecnico_asignado_at = fecha_ingreso para los que ya tienen técnico.
--   * los proyectos que ya están en un estado final del Kanban arrancan como
--     'finalizado' para que no ensucien el listado activo del tablero nuevo.
-- =============================================================================

DO $$
DECLARE
  r    RECORD;
  sch  text;
BEGIN
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

    -- 1) Columnas nuevas (idempotente).
    EXECUTE format(
      'ALTER TABLE %I.proyectos
         ADD COLUMN IF NOT EXISTS etapa_desarrollo text NOT NULL DEFAULT ''en_desarrollo''',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proyectos
         ADD COLUMN IF NOT EXISTS etapa_desarrollo_at timestamptz NOT NULL DEFAULT now()',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS etapa_finalizado_at timestamptz',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS tecnico_asignado_at timestamptz',
      sch
    );

    -- 2) Check de dominio.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'chk_proyectos_etapa_desarrollo'
        AND conrelid = format('%I.proyectos', sch)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.proyectos
           ADD CONSTRAINT chk_proyectos_etapa_desarrollo
           CHECK (etapa_desarrollo IN (''en_desarrollo'', ''esqueleto_finalizado'', ''qa'', ''finalizado''))',
        sch
      );
    END IF;

    -- Los backfill de abajo son correcciones de datos, no actividad del usuario:
    -- si dejamos vivo el trigger `set_updated_at`, `updated_at` queda pisado con
    -- la fecha de la migración en todas las filas tocadas (dato irrecuperable, y
    -- además hay métricas del dashboard que lo usan).
    EXECUTE format('ALTER TABLE %I.proyectos DISABLE TRIGGER tr_proyectos_updated', sch);

    -- 3) Backfill del contador de días: para los proyectos que ya tienen técnico
    --    no hay registro de cuándo se lo asignaron, así que usamos el ingreso.
    EXECUTE format(
      'UPDATE %I.proyectos
          SET tecnico_asignado_at = COALESCE(fecha_ingreso, created_at)
        WHERE responsable_tecnico_id IS NOT NULL
          AND tecnico_asignado_at IS NULL',
      sch
    );

    -- 4) Backfill de etapa: lo que ya está entregado/cancelado en el Kanban
    --    entra directo como finalizado (no debe aparecer en el listado activo).
    --    La fecha sale del historial de estados —la primera entrada a un estado
    --    final—, que es la fuente autoritativa; `updated_at` no sirve porque
    --    refleja cualquier edición posterior.
    EXECUTE format(
      'UPDATE %I.proyectos p
          SET etapa_desarrollo = ''finalizado'',
              etapa_finalizado_at = COALESCE(p.fecha_entrega, h.primera, now())
         FROM %I.proyecto_estados e
         LEFT JOIN LATERAL (
                SELECT MIN(eh.entered_at) AS primera
                  FROM %I.proyecto_estado_historial eh
                  JOIN %I.proyecto_estados e2
                    ON e2.id = eh.estado_nuevo_id
                   AND e2.empresa_id = eh.empresa_id
                 WHERE eh.proyecto_id = p.id
                   AND eh.empresa_id = p.empresa_id
                   AND e2.es_estado_final = true
              ) h ON true
        WHERE e.id = p.estado_id
          AND e.empresa_id = p.empresa_id
          AND e.es_estado_final = true
          AND p.etapa_desarrollo = ''en_desarrollo''
          AND p.etapa_finalizado_at IS NULL',
      sch, sch, sch, sch
    );

    EXECUTE format('ALTER TABLE %I.proyectos ENABLE TRIGGER tr_proyectos_updated', sch);

    -- 5) Índices para el tablero por programador y el reporte mensual.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I
         ON %I.proyectos (empresa_id, etapa_desarrollo, responsable_tecnico_id)',
      'ix_pr_etapa_' || replace(md5(sch::text), '-', '_'),
      sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I
         ON %I.proyectos (empresa_id, etapa_finalizado_at)',
      'ix_pr_etapafin_' || replace(md5(sch::text), '-', '_'),
      sch
    );
  END LOOP;
END $$;
