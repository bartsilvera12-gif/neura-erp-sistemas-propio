-- =============================================================================
-- Bandera `es_tecnico` en usuarios
--
-- El selector "Técnico responsable" listaba a TODA la empresa —comerciales,
-- administración, marketing— porque no había forma de saber quién es técnico:
--
--   · `rol` es el permiso del ERP, no la función;
--   · `area` está cargada de forma poco confiable, y no es una opinión: la
--     técnica con más proyectos figura en "soporte" y otro en "ventas".
--
-- Se agrega la bandera siguiendo el patrón que ya existe para `es_qa` y
-- `es_project_manager`: una función explícita, administrable desde la ficha del
-- usuario, independiente del nivel de permisos.
--
-- El backfill la deduce de la ASIGNACIÓN REAL: quien alguna vez fue responsable
-- técnico de un proyecto, lo es. Es el mismo criterio que ya usa el módulo para
-- decidir accesos (ver `qa-permisos.ts`) y el único dato que el sistema mantiene
-- solo, sin depender de que alguien complete un campo.
-- =============================================================================

DO $$
DECLARE
  r       RECORD;
  sch     text;
  cat_sch text;
BEGIN
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

  EXECUTE format(
    'ALTER TABLE %I.usuarios ADD COLUMN IF NOT EXISTS es_tecnico boolean NOT NULL DEFAULT false',
    cat_sch
  );

  -- Backfill por asignación real, en cada schema que tenga proyectos.
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
  LOOP
    sch := r.sch;
    EXECUTE format(
      'UPDATE %I.usuarios u
          SET es_tecnico = true
        WHERE u.es_tecnico = false
          AND EXISTS (
            SELECT 1 FROM %I.proyectos p WHERE p.responsable_tecnico_id = u.id
          )',
      cat_sch, sch
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
