-- Project manager a cargo de un cliente.
--
-- POR QUÉ: `usuarios.es_project_manager` ya existía, pero no había ningún
-- vínculo entre un PM y su cartera: `clientes` sólo tenía `vendedor_usuario_id`
-- (comercial) y `proyectos` tiene responsable comercial, técnico y QA. El
-- módulo "Gestión Project Manager" necesita saber qué clientes atiende cada PM.
--
-- MODELO: un PM por cliente, igual que el vendedor. Nullable, porque hoy no hay
-- ninguna asignación cargada y el resto del ERP tiene que seguir funcionando
-- con la columna vacía.
--
-- MULTI-TENANT: los schemas se descubren por PRESENCIA DE TABLA, nunca por una
-- lista fija de nombres. Se exige que el schema tenga `clientes` Y `usuarios`,
-- porque la FK apunta a `usuarios` del MISMO schema (así lo hace ya
-- `clientes_vendedor_usuario_id_fkey`).
--
-- Es una columna nueva sobre una tabla existente: no hace falta GRANT (la ACL
-- se hereda de la tabla) ni tocar políticas de RLS.

DO $$
DECLARE
  s text;
  n int := 0;
BEGIN
  FOR s IN
    SELECT n1.nspname
    FROM pg_class c1
    JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
    WHERE c1.relname = 'clientes'
      AND c1.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_class c2
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE c2.relname = 'usuarios' AND c2.relkind = 'r' AND n2.nspname = n1.nspname
      )
    ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %I.clientes ADD COLUMN IF NOT EXISTS project_manager_id uuid', s);

    -- La FK se agrega aparte porque ADD COLUMN IF NOT EXISTS no la trae, y
    -- ADD CONSTRAINT no tiene IF NOT EXISTS: se consulta el catálogo.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'clientes_project_manager_id_fkey'
        AND conrelid = format('%I.clientes', s)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.clientes ADD CONSTRAINT clientes_project_manager_id_fkey
           FOREIGN KEY (project_manager_id) REFERENCES %I.usuarios(id) ON DELETE SET NULL',
        s, s
      );
    END IF;

    -- El acceso natural es "todos los clientes de este PM": índice parcial, que
    -- sólo indexa las filas asignadas (hoy, ninguna).
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS clientes_project_manager_id_idx
         ON %I.clientes (project_manager_id) WHERE project_manager_id IS NOT NULL',
      s
    );

    n := n + 1;
  END LOOP;

  RAISE NOTICE 'project_manager_id aplicado en % schemas', n;
END $$;

NOTIFY pgrst, 'reload schema';
