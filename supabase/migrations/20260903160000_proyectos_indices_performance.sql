-- =============================================================================
-- Módulo Proyectos — Índices de performance
--
-- Dos índices que faltaban para las consultas más calientes del módulo:
--
--   1) Tablero (Kanban): el listado por defecto es
--        WHERE empresa_id=? AND archivado=? ORDER BY last_activity_at DESC
--      Sin índice, Postgres podía filtrar por empresa pero debía ORDENAR todo el
--      set del tenant en cada carga. El índice cubre filtro + orden.
--
--   2) Tablero "Tareas del equipo": la consulta de finalizados filtra
--        WHERE empresa_id=? AND etapa_desarrollo='finalizado'
--              AND etapa_finalizado_at ∈ [mes]
--      que no tenía índice propio.
--
-- Sólo crea índices (IF NOT EXISTS), idempotente y multi-schema. El nombre lleva
-- un sufijo por schema (los nombres de índice son globales por schema).
-- =============================================================================

DO $$
DECLARE
  r    RECORD;
  sch  text;
  suf  text;
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
    suf := replace(md5(sch::text), '-', '_');

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I
         ON %I.proyectos (empresa_id, archivado, last_activity_at DESC)',
      'ix_pr_lastact_' || suf,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I
         ON %I.proyectos (empresa_id, etapa_desarrollo, etapa_finalizado_at)',
      'ix_pr_etapadesarr_' || suf,
      sch
    );
  END LOOP;
END $$;
