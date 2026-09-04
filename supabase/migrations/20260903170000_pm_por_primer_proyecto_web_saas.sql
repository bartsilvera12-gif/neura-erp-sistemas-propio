-- Reparto automático de project managers: ahora por el PRIMER PROYECTO Web/SaaS
-- del cliente, no por el tipo de servicio del cliente.
--
-- POR QUÉ EL CAMBIO: asignar un PM a un cliente que todavía no tiene ningún
-- proyecto no tiene sentido (no hay nada que gestionar). La señal correcta es
-- "el cliente entró con un proyecto Web/SaaS". Este archivo:
--   1) ELIMINA el trigger anterior sobre `clientes` (asignaba por
--      `tipo_servicio_cliente`) y su función.
--   2) AGREGA un trigger AFTER INSERT sobre `proyectos` que, cuando entra un
--      proyecto Web / SaaS / mixto para un cliente que aún NO tiene PM, le asigna
--      el PM con la cartera más chica (mismo criterio auto-nivelante de antes).
--
-- POR QUÉ UN TRIGGER Y NO CÓDIGO DE APP: un proyecto puede nacer desde varios
-- caminos; en la base la regla se cumple venga el INSERT de donde venga.
--
-- NO TOCA: proyectos sin cliente, tipos que no son web/saas, ni clientes que ya
-- tienen PM (respeta la asignación manual) o que están inactivos/borrados.
--
-- ALCANCE: sólo el schema `neura`, igual que el trigger anterior.

-- 1) Fuera el reparto por tipo de cliente.
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['neura'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS clientes_asignar_project_manager ON %I.clientes', s);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.trg_clientes_asignar_project_manager();

-- 2) Reparto por primer proyecto Web/SaaS.
CREATE OR REPLACE FUNCTION public.trg_proyectos_asignar_pm_cliente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sch            text := TG_TABLE_SCHEMA;
  es_web_saas    boolean;
  cliente_sin_pm boolean;
  elegido        uuid;
BEGIN
  IF NEW.cliente_id IS NULL OR NEW.empresa_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ¿El proyecto es Web / SaaS / mixto? (por el código del tipo).
  EXECUTE format(
    'SELECT lower(coalesce(t.codigo,'''')) IN (''web'',''saas'',''web_saas'')
       FROM %I.proyecto_tipos t
      WHERE t.id = $1 AND t.empresa_id = $2',
    sch
  ) INTO es_web_saas USING NEW.tipo_id, NEW.empresa_id;
  IF NOT coalesce(es_web_saas, false) THEN
    RETURN NEW;
  END IF;

  -- El cliente debe existir, estar activo y NO tener PM (respeta lo ya asignado).
  EXECUTE format(
    'SELECT (c.project_manager_id IS NULL
             AND c.deleted_at IS NULL
             AND c.baja_operativa_at IS NULL
             AND lower(coalesce(c.estado, ''activo'')) = ''activo'')
       FROM %I.clientes c
      WHERE c.id = $1 AND c.empresa_id = $2',
    sch
  ) INTO cliente_sin_pm USING NEW.cliente_id, NEW.empresa_id;
  IF NOT coalesce(cliente_sin_pm, false) THEN
    RETURN NEW;
  END IF;

  -- El PM activo con la cartera más chica. Desempate por nombre e id: reproducible.
  EXECUTE format(
    $f$
    SELECT u.id
    FROM %I.usuarios u
    CROSS JOIN LATERAL (
      SELECT count(*) AS n
      FROM %I.clientes c
      WHERE c.empresa_id = $1
        AND c.project_manager_id = u.id
        AND c.deleted_at IS NULL
        AND c.baja_operativa_at IS NULL
        AND lower(coalesce(c.estado, 'activo')) = 'activo'
    ) k
    WHERE u.empresa_id = $1
      AND u.es_project_manager IS TRUE
      AND lower(coalesce(u.estado, 'activo')) = 'activo'
    ORDER BY k.n ASC, u.nombre ASC, u.id ASC
    LIMIT 1
    $f$,
    sch, sch
  )
  INTO elegido
  USING NEW.empresa_id;

  IF elegido IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I.clientes
          SET project_manager_id = $1
        WHERE id = $2 AND empresa_id = $3 AND project_manager_id IS NULL',
      sch
    ) USING elegido, NEW.cliente_id, NEW.empresa_id;
  END IF;

  RETURN NEW;
END $$;

DO $$
DECLARE
  s text;
  n int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY['neura'] LOOP
    -- Se exige que la pieza esté completa para no voltear el alta del proyecto.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = s AND table_name = 'clientes' AND column_name = 'project_manager_id'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = s AND table_name = 'usuarios' AND column_name = 'es_project_manager'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = s AND table_name = 'proyectos' AND column_name = 'cliente_id'
    ) THEN
      RAISE NOTICE 'schema % sin las columnas necesarias: se omite', s;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS proyectos_asignar_pm_cliente ON %I.proyectos', s);
    EXECUTE format(
      'CREATE TRIGGER proyectos_asignar_pm_cliente
         AFTER INSERT ON %I.proyectos
         FOR EACH ROW
         EXECUTE FUNCTION public.trg_proyectos_asignar_pm_cliente()',
      s
    );
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'trigger de autoasignacion por proyecto creado en % schemas', n;
END $$;
