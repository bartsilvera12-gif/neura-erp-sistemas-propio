-- =============================================================================
-- Corrección del backfill de 20260807120000_proyecto_etapa_desarrollo.sql
--
-- Problema: los UPDATE de backfill de aquella migración dispararon el trigger
-- `tr_proyectos_updated` (set_updated_at). Eso tuvo dos efectos:
--
--   1. `proyectos.updated_at` quedó pisado con la fecha de la migración en
--      todas las filas tocadas. Ese dato no es recuperable.
--   2. El backfill de `etapa_finalizado_at` usaba `COALESCE(fecha_entrega,
--      updated_at, now())`, y como el statement anterior ya había pisado
--      `updated_at`, la mayoría de los proyectos históricos quedaron datados
--      con la fecha de la migración en vez de su entrega real.
--
-- Corrección: recalcular `etapa_finalizado_at` desde `proyecto_estado_historial`,
-- que es la fuente autoritativa (la misma que usa el reporte "entregados por
-- técnico"): la PRIMERA vez que el proyecto entró a un estado final.
--
-- Los UPDATE de acá corren con el trigger deshabilitado para no volver a
-- ensuciar `updated_at`.
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

    CONTINUE WHEN NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = sch
        AND table_name = 'proyectos'
        AND column_name = 'etapa_finalizado_at'
    );

    EXECUTE format('ALTER TABLE %I.proyectos DISABLE TRIGGER tr_proyectos_updated', sch);

    BEGIN
      -- Fecha real de finalización = primera entrada a un estado final.
      EXECUTE format(
        'UPDATE %I.proyectos p
            SET etapa_finalizado_at = h.primera
           FROM (
                  SELECT eh.proyecto_id, eh.empresa_id, MIN(eh.entered_at) AS primera
                    FROM %I.proyecto_estado_historial eh
                    JOIN %I.proyecto_estados e
                      ON e.id = eh.estado_nuevo_id
                     AND e.empresa_id = eh.empresa_id
                   WHERE e.es_estado_final = true
                   GROUP BY eh.proyecto_id, eh.empresa_id
                ) h
          WHERE h.proyecto_id = p.id
            AND h.empresa_id = p.empresa_id
            AND p.etapa_desarrollo = ''finalizado''
            AND p.etapa_finalizado_at IS DISTINCT FROM h.primera',
        sch, sch, sch
      );

      -- Un finalizado nunca puede haber terminado antes de que se asignara el
      -- técnico: si el historial quedó incoherente, el contador de días se
      -- calcularía negativo. En ese caso alineamos la asignación al ingreso.
      EXECUTE format(
        'UPDATE %I.proyectos
            SET tecnico_asignado_at = LEAST(tecnico_asignado_at, etapa_finalizado_at)
          WHERE etapa_desarrollo = ''finalizado''
            AND tecnico_asignado_at IS NOT NULL
            AND etapa_finalizado_at IS NOT NULL
            AND tecnico_asignado_at > etapa_finalizado_at',
        sch
      );
    EXCEPTION WHEN OTHERS THEN
      EXECUTE format('ALTER TABLE %I.proyectos ENABLE TRIGGER tr_proyectos_updated', sch);
      RAISE;
    END;

    EXECUTE format('ALTER TABLE %I.proyectos ENABLE TRIGGER tr_proyectos_updated', sch);
  END LOOP;
END $$;
