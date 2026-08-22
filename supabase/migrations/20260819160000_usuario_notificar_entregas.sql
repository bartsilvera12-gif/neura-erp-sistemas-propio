-- =============================================================================
-- Flag `notificar_entregas` en el catálogo de usuarios
--
-- Marca a quién hay que avisarle cada vez que un proyecto llega a un estado
-- final ("Entregado"), además del comercial del proyecto. Es el aviso que
-- necesita quien coordina las entregas: le llega el de TODOS los proyectos, no
-- sólo el de los suyos.
--
-- Va como columna propia y no hardcodeado en el código —ni derivado de `rol`—
-- por lo mismo que `es_qa` y `es_project_manager`: quién coordina entregas
-- cambia con el tiempo, y `rol` gobierna los permisos de todo el ERP.
--
-- El schema de catálogo se detecta dinámicamente (neura | zentra_erp | public).
-- =============================================================================

DO $$
DECLARE
  cat_sch text;
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

  EXECUTE format(
    'ALTER TABLE %I.usuarios ADD COLUMN IF NOT EXISTS notificar_entregas boolean NOT NULL DEFAULT false',
    cat_sch
  );
  -- Índice parcial: la consulta es "quiénes de esta empresa reciben entregas",
  -- y los marcados son siempre unos pocos.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS ix_usuarios_notificar_entregas ON %I.usuarios (empresa_id) WHERE notificar_entregas',
    cat_sch
  );

  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
