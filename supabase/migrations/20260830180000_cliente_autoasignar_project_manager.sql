-- Reparto automático de los clientes nuevos entre los project managers.
--
-- POR QUÉ UN TRIGGER Y NO CÓDIGO DE LA APP: un cliente no nace en un solo
-- lugar — está el alta de /api/clientes, la conversión de un prospecto del CRM,
-- importaciones y lo que venga después. Con la regla en la aplicación habría
-- que acordarse de repetirla en cada camino nuevo, y el que se olvide deja
-- clientes huérfanos sin que nadie se entere. En la base, la regla se cumple
-- venga el INSERT de donde venga.
--
-- CRITERIO: al PM con MENOS clientes activos en ese momento. Es auto-nivelante
-- (después de recibir uno deja de ser el que menos tiene, así que el siguiente
-- va al otro) y no necesita guardar ningún contador ni turno.
--
-- A QUIÉNES: sólo clientes de SaaS/ERP o Web (`tipo_servicio_cliente` en
-- 'saas' / 'web'). Los CONTABLES (slug 'otro') no llevan project manager, ni
-- tampoco marketing ni los que todavía no tienen tipo cargado.
--
-- NO TOCA: un alta que ya viene con `project_manager_id` (respeta la decisión
-- de quien la cargó), ni los clientes que nacen borrados, con baja operativa o
-- inactivos — repartir esos ensuciaría las carteras con fichas muertas, que es
-- el mismo criterio con el que se repartió la cartera inicial.
--
-- TAMBIÉN EN UPDATE: es habitual dar de alta el cliente y recién después
-- elegirle el tipo de servicio. Si sólo mirara el INSERT, esos clientes
-- quedarían sin PM para siempre; por eso también corre cuando cambia
-- `tipo_servicio_cliente` y el cliente todavía no tiene PM.
--
-- Si la empresa no tiene ningún PM marcado, queda en NULL y no falla el alta.

CREATE OR REPLACE FUNCTION public.trg_clientes_asignar_project_manager()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sch     text := TG_TABLE_SCHEMA;
  elegido uuid;
BEGIN
  IF NEW.empresa_id IS NULL OR NEW.project_manager_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL
     OR NEW.baja_operativa_at IS NOT NULL
     OR lower(coalesce(NEW.estado, 'activo')) <> 'activo' THEN
    RETURN NEW;
  END IF;

  IF lower(coalesce(NEW.tipo_servicio_cliente, '')) NOT IN ('saas', 'web') THEN
    RETURN NEW;
  END IF;

  -- El PM activo con la cartera más chica. El desempate por nombre e id hace
  -- que dos altas iguales den siempre el mismo resultado (reproducible).
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

  NEW.project_manager_id := elegido;
  RETURN NEW;
END $$;

-- ALCANCE: SOLO el schema `neura`.
--
-- A diferencia de otras migraciones de este repo, acá NO se descubren schemas
-- por presencia de tabla: la gestión de project managers es una función que
-- hoy se usa únicamente en este tenant, y un trigger que se dispara en cada
-- alta de cliente no tiene por qué existir en los demás. Si mañana otro tenant
-- lo necesita, se agrega su schema a la lista de forma explícita.
DO $$
DECLARE
  s text;
  n int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY['neura'] LOOP
    -- Se exige que la pieza esté completa: sin `clientes.project_manager_id` o
    -- sin `usuarios.es_project_manager` la función no tendría a quién elegir y
    -- el EXECUTE voltearía el alta del cliente.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = s AND table_name = 'clientes' AND column_name = 'project_manager_id'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = s AND table_name = 'usuarios' AND column_name = 'es_project_manager'
    ) THEN
      RAISE NOTICE 'schema % sin las columnas necesarias: se omite', s;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS clientes_asignar_project_manager ON %I.clientes', s);
    EXECUTE format(
      'CREATE TRIGGER clientes_asignar_project_manager
         BEFORE INSERT OR UPDATE OF tipo_servicio_cliente ON %I.clientes
         FOR EACH ROW
         EXECUTE FUNCTION public.trg_clientes_asignar_project_manager()',
      s
    );
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'trigger de autoasignacion creado en % schemas', n;
END $$;
