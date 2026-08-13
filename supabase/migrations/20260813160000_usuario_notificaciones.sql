-- =============================================================================
-- Notificaciones in-app por usuario (campanita del header + badge en Proyectos)
--
-- Primer sistema de notificaciones para usuarios del ERP. Toma la forma del de
-- Contact Center (`agent_notification_events`) —tabla de eventos con estado de
-- lectura— pero no lo reusa: aquél está atado por FK a `chat_conversations` y
-- el destinatario es un agente, no un usuario del catálogo.
--
-- Origen inicial: el módulo QA de proyectos (`qa_novedad`, `qa_aprobado`,
-- `qa_rechazado`). El CHECK de `tipo` queda listo para crecer a otros módulos.
--
-- -----------------------------------------------------------------------------
-- Dos piezas que esta migración necesita crear antes de la tabla:
--
-- 1) `usuario_id_actual()`. La RLS de este ERP sabe de qué empresa sos
--    (`puede_acceder_empresa`) pero no quién sos, y acá eso no alcanza: una
--    notificación es de una persona, no de una empresa. Sin este helper la
--    policy dejaría a cualquier usuario de la empresa leer las notificaciones
--    de sus compañeros. Se define junto a `empresa_id_actual()` y con el mismo
--    criterio (match por email del JWT, case-insensitive).
--
-- 2) `usuarios.es_project_manager`. La aprobación de QA se le avisa a la
--    project manager, rol que hoy no existe en el modelo. Va como flag propio y
--    NO como valor de `usuarios.rol`, porque esa columna gobierna los permisos
--    de todo el ERP y pisarla dejaría a la PM sin sus accesos actuales.
--
-- Se replica en todo schema con `proyectos`. El schema de catálogo (empresas +
-- usuarios) se detecta dinámicamente (neura | zentra_erp | public).
-- =============================================================================

DO $$
DECLARE
  r        RECORD;
  sch      text;
  cat_sch  text;
  rls_sch  text;
  upd_sch  text;
  soy_dueno boolean;
BEGIN
  -- Detectar schema de catálogo (empresas + usuarios conviviendo).
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

  -- Detectar schema de puede_acceder_empresa(uuid) — opcional.
  SELECT n.nspname INTO rls_sch
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'puede_acceder_empresa'
    AND p.pronargs = 1
    AND p.proargtypes[0] = 'uuid'::regtype
  ORDER BY CASE n.nspname
    WHEN 'public' THEN 1
    WHEN 'zentra_erp' THEN 2
    WHEN 'neura' THEN 3
    ELSE 4
  END
  LIMIT 1;

  -- Detectar set_updated_at() — opcional.
  SELECT n.nspname INTO upd_sch
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'set_updated_at'
    AND p.pronargs = 0
  ORDER BY CASE n.nspname
    WHEN 'public' THEN 1
    WHEN 'zentra_erp' THEN 2
    WHEN 'neura' THEN 3
    ELSE 4
  END
  LIMIT 1;

  -- ==========================================================================
  -- 1) Flag de project manager en el catálogo de usuarios.
  -- ==========================================================================
  EXECUTE format(
    'ALTER TABLE %I.usuarios ADD COLUMN IF NOT EXISTS es_project_manager boolean NOT NULL DEFAULT false',
    cat_sch
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS ix_usuarios_project_manager ON %I.usuarios (empresa_id) WHERE es_project_manager',
    cat_sch
  );

  -- ==========================================================================
  -- 2) usuario_id_actual(): el id de catálogo del usuario autenticado.
  --
  -- Vive en el schema donde ya está `puede_acceder_empresa` (o en el catálogo
  -- si aquélla no existe) para que las policies de abajo puedan llamar a las
  -- dos con el mismo prefijo. SECURITY DEFINER + search_path fijo, igual que
  -- `empresa_id_actual()`: la policy se evalúa como el usuario invocante, que
  -- no necesariamente puede leer `usuarios`.
  -- ==========================================================================
  --
  -- Se crea sólo si no existe, y no con CREATE OR REPLACE, por un detalle de
  -- Supabase: los objetos nuevos quedan a nombre de `supabase_admin`, mientras
  -- que las migraciones suelen aplicarse conectado como `postgres`. Un
  -- CREATE OR REPLACE sobre una función que ya existe falla entonces con
  -- `42501 must be owner of function`, y eso rompería la propiedad que
  -- buscamos en todo este archivo: que volver a correrlo repare en vez de
  -- explotar. Si algún día hay que cambiarle el cuerpo, hay que hacerlo
  -- conectado como el dueño (o con un DROP previo por el dueño).
  --
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'usuario_id_actual'
      AND p.pronargs = 0
      AND n.nspname = COALESCE(rls_sch, cat_sch)
  ) THEN
    EXECUTE format(
      $fn$
      CREATE FUNCTION %I.usuario_id_actual()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = %I, public
      AS $body$
        SELECT id
        FROM %I.usuarios
        WHERE lower(email) = lower(auth.jwt() ->> 'email')
        LIMIT 1;
      $body$;
      $fn$,
      COALESCE(rls_sch, cat_sch), cat_sch, cat_sch
    );
  END IF;

  -- Los GRANT sobre la función también requieren ser el dueño. Si ya están
  -- puestos (caso normal en una re-ejecución) el error se ignora: son
  -- idempotentes por naturaleza y no vale la pena abortar la migración por eso.
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.usuario_id_actual() TO authenticated',
        COALESCE(rls_sch, cat_sch)
      );
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.usuario_id_actual() TO service_role',
        COALESCE(rls_sch, cat_sch)
      );
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'GRANT EXECUTE sobre usuario_id_actual omitido: la función pertenece a otro rol';
  END;

  -- ==========================================================================
  -- 3) usuario_notificaciones, por cada schema con proyectos.
  -- ==========================================================================
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c2
    JOIN pg_namespace n ON n.oid = c2.relnamespace
    WHERE c2.relname = 'proyectos'
      AND c2.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    IF to_regclass(format('%I.usuario_notificaciones', sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %I.usuario_notificaciones (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
          usuario_id uuid NOT NULL REFERENCES %I.usuarios(id) ON DELETE CASCADE,
          tipo text NOT NULL,
          titulo text NOT NULL,
          cuerpo text,
          proyecto_id uuid REFERENCES %I.proyectos(id) ON DELETE CASCADE,
          observacion_id uuid,
          evento_id uuid,
          -- Cuántos cambios de QA quedaron representados en esta fila. Una
          -- sesión de QA cargando 15 observaciones tiene que producir una
          -- notificación que diga 15, no 15 notificaciones.
          agrupadas integer NOT NULL DEFAULT 1,
          actor_id uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          leida_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          CONSTRAINT chk_unotif_titulo_non_empty CHECK (length(trim(titulo)) > 0)
        )
        $sql$, sch, cat_sch, cat_sch, sch, cat_sch
      );
    END IF;

    -- ========================================================================
    -- A partir de acá van los pasos "de reparación": CHECK, RLS, policies y
    -- GRANTs se re-aplican en cada corrida (fuera del IF de creación) para que
    -- volver a correr este archivo repare una tabla que ya existía.
    --
    -- Todos requieren ser DUEÑO de la tabla. En Supabase los objetos nuevos
    -- quedan a nombre de `supabase_admin`, así que si la migración se aplica
    -- conectado como `postgres` —que no es miembro de ese rol— fallan con
    -- `42501 must be owner of table`. En vez de abortar la migración entera,
    -- se detecta la propiedad y se avisa: aplicar como dueño es lo que hay que
    -- hacer para que la reparación surta efecto, pero no tiene sentido que una
    -- migración explote cuando el resto sí pudo aplicarse.
    -- ========================================================================
    SELECT pg_get_userbyid(c2.relowner) = current_user INTO soy_dueno
    FROM pg_class c2
    WHERE c2.oid = format('%I.usuario_notificaciones', sch)::regclass;

    IF NOT COALESCE(soy_dueno, false) THEN
      RAISE NOTICE
        'Schema %: la tabla usuario_notificaciones pertenece a otro rol; se omiten CHECK, RLS, policies y GRANTs. Volvé a aplicar esta migración conectado como el dueño para repararlos.',
        sch;
    END IF;

    IF COALESCE(soy_dueno, false) THEN
      -- El CHECK de `tipo` se recrea siempre para que agregar un tipo nuevo sea
      -- sólo editar esta lista y volver a correr la migración.
      EXECUTE format(
        'ALTER TABLE %I.usuario_notificaciones DROP CONSTRAINT IF EXISTS chk_unotif_tipo',
        sch
      );
      EXECUTE format(
        $sql$
        ALTER TABLE %I.usuario_notificaciones
        ADD CONSTRAINT chk_unotif_tipo CHECK (tipo IN (
          'qa_novedad', 'qa_aprobado', 'qa_rechazado'
        ))
        $sql$, sch
      );
    END IF;

    -- Los índices también requieren ser dueño de la tabla.
    IF COALESCE(soy_dueno, false) THEN
    -- Contador de no leídas y listado del panel.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.usuario_notificaciones (empresa_id, usuario_id, leida_at, created_at DESC)',
      'ix_unotif_' || replace(md5(sch::text), '-', '_'), sch
    );
    -- Badge de la lista de proyectos: "¿este usuario tiene novedades sin leer
    -- en este proyecto?" se resuelve con este índice, sin escanear la tabla.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.usuario_notificaciones (empresa_id, usuario_id, proyecto_id) WHERE leida_at IS NULL',
      'ix_unotif_proy_' || replace(md5(sch::text), '-', '_'), sch
    );
    -- Clave del agrupado: como mucho UNA `qa_novedad` sin leer por proyecto y
    -- usuario. Es lo que convierte el "actualizá la existente en vez de
    -- insertar otra" en algo libre de carreras entre requests concurrentes.
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.usuario_notificaciones (empresa_id, usuario_id, proyecto_id) WHERE tipo = ''qa_novedad'' AND leida_at IS NULL',
      'uq_unotif_novedad_' || replace(md5(sch::text), '-', '_'), sch
    );
    END IF;

    IF upd_sch IS NOT NULL AND COALESCE(soy_dueno, false) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS tr_unotif_updated ON %I.usuario_notificaciones',
        sch
      );
      EXECUTE format(
        'CREATE TRIGGER tr_unotif_updated BEFORE UPDATE ON %I.usuario_notificaciones FOR EACH ROW EXECUTE FUNCTION %I.set_updated_at()',
        sch, upd_sch
      );
    END IF;

    -- ========================================================================
    -- RLS — policies AFUERA del IF de creación a propósito.
    --
    -- La migración de observaciones de QA las dejó adentro: si esa tabla ya
    -- existía cuando se corrió, se quedó sin policies y nadie se entera hasta
    -- que algo falla en producción. Acá se hace DROP + CREATE en cada corrida,
    -- así una re-ejecución repara tablas preexistentes.
    --
    -- Filtrar por empresa NO alcanza: una notificación es de una persona. Sin
    -- el `usuario_id = usuario_id_actual()` cualquier compañero de empresa
    -- podría leer —vía PostgREST o vía Realtime— las notificaciones ajenas.
    --
    -- No hay policy de INSERT/DELETE: las crea el backend con service_role,
    -- que no pasa por RLS. Lo único que el navegador puede hacer es leer las
    -- suyas y marcarlas como leídas.
    -- ========================================================================
    IF rls_sch IS NOT NULL AND COALESCE(soy_dueno, false) THEN
      EXECUTE format('ALTER TABLE %I.usuario_notificaciones ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format('DROP POLICY IF EXISTS usuario_notificaciones_select ON %I.usuario_notificaciones', sch);
      EXECUTE format(
        'CREATE POLICY usuario_notificaciones_select ON %I.usuario_notificaciones FOR SELECT USING (%I.puede_acceder_empresa(empresa_id) AND usuario_id = %I.usuario_id_actual())',
        sch, rls_sch, rls_sch
      );

      EXECUTE format('DROP POLICY IF EXISTS usuario_notificaciones_update ON %I.usuario_notificaciones', sch);
      EXECUTE format(
        'CREATE POLICY usuario_notificaciones_update ON %I.usuario_notificaciones FOR UPDATE USING (%I.puede_acceder_empresa(empresa_id) AND usuario_id = %I.usuario_id_actual()) WITH CHECK (%I.puede_acceder_empresa(empresa_id) AND usuario_id = %I.usuario_id_actual())',
        sch, rls_sch, rls_sch, rls_sch, rls_sch
      );
    END IF;

    -- ========================================================================
    -- Privilegios — también afuera del IF de creación.
    --
    -- Las migraciones las aplica `supabase_admin` y las tablas que crea ese rol
    -- nacen con ACL nula (los DEFAULT PRIVILEGES del schema son para
    -- `postgres`). Sin GRANT explícito la API responde `42501`.
    --
    -- `anon` no recibe nada: estas filas son personales. `authenticated` sólo
    -- lee y marca leídas; el alta es exclusiva del backend.
    -- ========================================================================
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON %I.usuario_notificaciones FROM anon', sch);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('GRANT SELECT, UPDATE ON %I.usuario_notificaciones TO authenticated', sch);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.usuario_notificaciones TO service_role', sch);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Schema %: GRANTs de usuario_notificaciones omitidos (la tabla pertenece a otro rol)', sch;
    END;

    -- ========================================================================
    -- El veredicto de QA (aprobar / rechazar) entra al audit trail existente.
    -- Se reemplaza el CHECK completo porque `ADD CONSTRAINT` no sabe extender:
    -- el nombre se detecta dinámicamente por si quedó el autogenerado.
    -- ========================================================================
    IF to_regclass(format('%I.proyecto_qa_eventos', sch)) IS NOT NULL THEN
      DECLARE
        c RECORD;
      BEGIN
        FOR c IN
          SELECT con.conname
          FROM pg_constraint con
          WHERE con.conrelid = format('%I.proyecto_qa_eventos', sch)::regclass
            AND con.contype = 'c'
            AND pg_get_constraintdef(con.oid) ILIKE '%accion%'
        LOOP
          EXECUTE format('ALTER TABLE %I.proyecto_qa_eventos DROP CONSTRAINT %I', sch, c.conname);
        END LOOP;

        EXECUTE format(
          $sql$
          ALTER TABLE %I.proyecto_qa_eventos
          ADD CONSTRAINT chk_pqev_accion CHECK (accion IN (
            'grupo_creado','grupo_editado','grupo_eliminado',
            'etapa_creada','etapa_editada','etapa_eliminada',
            'item_creado','item_editado','item_eliminado',
            'item_marcado','item_desmarcado',
            'comentario_editado',
            'archivo_subido','archivo_eliminado',
            'qa_clonado',
            'observacion_creada','observacion_editada','observacion_eliminada',
            'observacion_estado_cambiado','observacion_asignada',
            'observacion_comentada','observacion_archivo_subido','observacion_archivo_eliminado',
            'seccion_creada','seccion_editada','seccion_eliminada',
            'qa_aprobado','qa_rechazado'
          ))
          $sql$, sch
        );
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'Schema %: CHECK de proyecto_qa_eventos no actualizado (la tabla pertenece a otro rol)', sch;
      END;
    END IF;

    -- Realtime: es lo que hace subir el contador de la campanita sin recargar.
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = sch
          AND tablename = 'usuario_notificaciones'
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I.usuario_notificaciones', sch);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
