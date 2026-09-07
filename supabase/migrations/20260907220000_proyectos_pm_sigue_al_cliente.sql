-- =============================================================================
-- El PM del proyecto sigue al de su cliente — garantizado en la base
--
-- La regla ya se aplica en la API, pero quedaba un agujero que sólo aparece con
-- CLIENTES NUEVOS:
--
--   1. la API lee el PM del cliente para el proyecto que va a crear → todavía
--      no tiene, así que el proyecto nace en NULL;
--   2. se inserta el proyecto;
--   3. el trigger `proyectos_asignar_pm_cliente` reparte una PM al CLIENTE,
--      porque es su primer proyecto Web/SaaS;
--   4. resultado: el cliente queda con PM y su proyecto sin ninguno.
--
-- Es imposible de resolver desde la API sin releer después del insert, así que
-- se resuelve donde ocurre. Dos cambios:
--
--   · el trigger de alta ahora también escribe el PM en el proyecto recién
--     insertado, sea el que el cliente ya tenía o el que se le acaba de
--     asignar;
--   · un trigger nuevo en `clientes` propaga el cambio de PM a sus proyectos.
--
-- Con esto la regla vale para cualquier camino —la app, una importación, un
-- script— y no sólo para el que pasa por la API.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
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
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch AND table_name = 'proyectos' AND column_name = 'project_manager_id'
    );

    -- ---------------------------------------------------------------------
    -- 1) Alta de proyecto: el PM del cliente baja al proyecto.
    -- ---------------------------------------------------------------------
    EXECUTE format(
      $fn$
      CREATE OR REPLACE FUNCTION %I.trg_proyectos_pm_desde_cliente()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $body$
      DECLARE
        pm uuid;
      BEGIN
        IF NEW.cliente_id IS NULL THEN
          RETURN NEW;
        END IF;

        -- Corre DESPUÉS del trigger que reparte cartera, así que acá el cliente
        -- ya tiene su PM definitivo (el de siempre o el recién asignado).
        SELECT c.project_manager_id INTO pm
        FROM %I.clientes c
        WHERE c.id = NEW.cliente_id AND c.empresa_id = NEW.empresa_id;

        IF pm IS DISTINCT FROM NEW.project_manager_id THEN
          UPDATE %I.proyectos
             SET project_manager_id = pm
           WHERE id = NEW.id AND empresa_id = NEW.empresa_id;
        END IF;

        RETURN NEW;
      END;
      $body$
      $fn$,
      sch, sch, sch
    );

    -- El nombre arranca con `z_` a propósito: Postgres dispara los triggers de
    -- un mismo evento por orden alfabético, y éste TIENE que correr después de
    -- `proyectos_asignar_pm_cliente`, que es quien elige la cartera.
    EXECUTE format('DROP TRIGGER IF EXISTS z_proyectos_pm_desde_cliente ON %I.proyectos', sch);
    EXECUTE format(
      'CREATE TRIGGER z_proyectos_pm_desde_cliente
         AFTER INSERT ON %I.proyectos
         FOR EACH ROW EXECUTE FUNCTION %I.trg_proyectos_pm_desde_cliente()',
      sch, sch
    );

    -- ---------------------------------------------------------------------
    -- 2) Cambio de PM en la ficha del cliente: arrastra sus proyectos.
    -- ---------------------------------------------------------------------
    EXECUTE format(
      $fn$
      CREATE OR REPLACE FUNCTION %I.trg_clientes_pm_a_proyectos()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $body$
      BEGIN
        IF NEW.project_manager_id IS DISTINCT FROM OLD.project_manager_id THEN
          UPDATE %I.proyectos
             SET project_manager_id = NEW.project_manager_id
           WHERE cliente_id = NEW.id
             AND empresa_id = NEW.empresa_id
             AND archivado = false
             AND project_manager_id IS DISTINCT FROM NEW.project_manager_id;
        END IF;
        RETURN NEW;
      END;
      $body$
      $fn$,
      sch, sch
    );

    EXECUTE format('DROP TRIGGER IF EXISTS trg_clientes_pm_a_proyectos ON %I.clientes', sch);
    EXECUTE format(
      'CREATE TRIGGER trg_clientes_pm_a_proyectos
         AFTER UPDATE OF project_manager_id ON %I.clientes
         FOR EACH ROW EXECUTE FUNCTION %I.trg_clientes_pm_a_proyectos()',
      sch, sch
    );
  END LOOP;
END $$;

-- Realineado por si quedó algo desincronizado antes de estos triggers.
DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyectos' AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    sch := r.sch;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch AND table_name = 'proyectos' AND column_name = 'project_manager_id'
    );
    EXECUTE format(
      'UPDATE %I.proyectos p
          SET project_manager_id = c.project_manager_id
         FROM %I.clientes c
        WHERE c.id = p.cliente_id
          AND p.archivado = false
          AND p.project_manager_id IS DISTINCT FROM c.project_manager_id',
      sch, sch
    );
  END LOOP;
END $$;
