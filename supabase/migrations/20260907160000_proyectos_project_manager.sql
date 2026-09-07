-- =============================================================================
-- Project Manager a nivel de PROYECTO
--
-- Hasta ahora el PM salía sólo de la ficha del cliente
-- (`clientes.project_manager_id`), así que todos los proyectos de un cliente
-- caían sí o sí en el mismo PM y los proyectos SIN cliente no podían tener
-- responsable. Esta columna permite asignar el PM en el proyecto.
--
-- La ficha del cliente NO deja de valer: sigue siendo el valor por defecto. Un
-- proyecto con `project_manager_id` en NULL se sigue leyendo como "el PM de su
-- cliente", que es lo que hace que esta migración no cambie nada de lo que ya
-- estaba asignado.
--
-- Idempotente y multi-schema, como el resto del módulo.
-- =============================================================================

DO $$
DECLARE
  r       RECORD;
  sch     text;
  cat_sch text;
BEGIN
  -- Los usuarios viven en el schema de catálogo, que no es el del tenant.
  SELECT n.nspname INTO cat_sch
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'usuarios' AND c.relkind = 'r'
  ORDER BY CASE n.nspname
    WHEN 'neura' THEN 1 WHEN 'zentra_erp' THEN 2 WHEN 'public' THEN 3 ELSE 4
  END
  LIMIT 1;

  IF cat_sch IS NULL THEN
    RAISE EXCEPTION 'No se encontró schema con tabla `usuarios`';
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

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch AND table_name = 'proyectos' AND column_name = 'project_manager_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.proyectos
           ADD COLUMN project_manager_id uuid
           REFERENCES %I.usuarios(id) ON DELETE SET NULL',
        sch, cat_sch
      );
    END IF;

    -- El dashboard PM filtra por "mi cartera": este índice es el que evita el
    -- scan completo cuando la empresa tenga miles de proyectos.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyectos (empresa_id, project_manager_id) WHERE archivado = false',
      'ix_pr_pm_' || replace(md5(sch::text), '-', '_'),
      sch
    );
  END LOOP;
END $$;

-- Sin esto la API responde 400 "could not find column in schema cache".
NOTIFY pgrst, 'reload schema';
