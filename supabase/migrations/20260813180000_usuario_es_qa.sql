-- =============================================================================
-- Flag `es_qa` en el catálogo de usuarios
--
-- La persona de QA no es un eje aparte que se asigne proyecto por proyecto: es
-- una integrante más del equipo, con su propia tarjeta en "Tareas del equipo".
-- Lo único que cambia respecto de un programador es el vocabulario de etapas
-- (Revisión pre-entrega / Cambios / Finalizado en vez de En Desarrollo /
-- Esqueleto / QA / Finalizado), y eso se decide mirando este flag.
--
-- Va como columna propia y NO como valor de `usuarios.rol`, por lo mismo que
-- `es_project_manager`: `rol` gobierna los permisos de todo el ERP y pisarlo
-- dejaría a la persona sin sus accesos.
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
    'ALTER TABLE %I.usuarios ADD COLUMN IF NOT EXISTS es_qa boolean NOT NULL DEFAULT false',
    cat_sch
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS ix_usuarios_es_qa ON %I.usuarios (empresa_id) WHERE es_qa',
    cat_sch
  );

  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
