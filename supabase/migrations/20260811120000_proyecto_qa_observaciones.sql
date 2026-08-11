-- =============================================================================
-- Módulo Proyectos — QA Observaciones
--
-- Registro de hallazgos / ajustes pendientes de QA (tracker), complementario al
-- checklist jerárquico de 20260619120000_proyecto_qa_checklists.sql. El checklist
-- NO se toca: ambas vistas conviven dentro de la pestaña QA.
--
-- Estructura: Proyecto -> Secciones (ej: "Checkout") -> Observaciones (QA-001,
-- con estado/severidad/origen), cada una con adjuntos e hilo de comentarios.
-- El audit trail es compartido: se reutiliza `proyecto_qa_eventos` extendiendo
-- el CHECK de `accion` y agregando `observacion_id`.
--
-- Se replica en todo schema con `proyectos`. El schema de catálogo
-- (empresas, usuarios) se detecta dinámicamente (neura | zentra_erp | public).
-- RLS via puede_acceder_empresa(empresa_id) cuando exista.
-- =============================================================================

DO $$
DECLARE
  r        RECORD;
  c        RECORD;
  sch      text;
  tbl      text;
  cat_sch  text;
  rls_sch  text;
  upd_sch  text;
  ev_rel   regclass;
BEGIN
  -- Detectar schema de catálogo (empresas + usuarios coexistiendo).
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

    -- =========================================================================
    -- proyecto_qa_secciones — catálogo de secciones por proyecto
    -- =========================================================================
    IF to_regclass(format('%I.proyecto_qa_secciones', sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %I.proyecto_qa_secciones (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
          proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
          nombre text NOT NULL,
          color text,
          sort_order integer NOT NULL DEFAULT 0,
          created_by uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_pqsec_nombre_non_empty CHECK (length(trim(nombre)) > 0)
        )
        $sql$, sch, cat_sch, sch, cat_sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_qa_secciones (empresa_id, proyecto_id, sort_order)',
        'ix_pqsec_' || replace(md5(sch::text), '-', '_'), sch
      );
      -- Una sección por nombre normalizado dentro del proyecto.
      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.proyecto_qa_secciones (empresa_id, proyecto_id, lower(trim(nombre)))',
        'uq_pqsec_nombre_' || replace(md5(sch::text), '-', '_'), sch
      );

      IF rls_sch IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.proyecto_qa_secciones ENABLE ROW LEVEL SECURITY', sch);
        EXECUTE format('CREATE POLICY proyecto_qa_secciones_select ON %I.proyecto_qa_secciones FOR SELECT USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_secciones_insert ON %I.proyecto_qa_secciones FOR INSERT WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_secciones_update ON %I.proyecto_qa_secciones FOR UPDATE USING (%I.puede_acceder_empresa(empresa_id)) WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_secciones_delete ON %I.proyecto_qa_secciones FOR DELETE USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
      END IF;

      IF upd_sch IS NOT NULL THEN
        EXECUTE format('CREATE TRIGGER tr_pqsec_updated BEFORE UPDATE ON %I.proyecto_qa_secciones FOR EACH ROW EXECUTE FUNCTION %I.set_updated_at()', sch, upd_sch);
      END IF;
    END IF;

    -- =========================================================================
    -- proyecto_qa_observaciones
    -- `numero` es correlativo por proyecto (se muestra como QA-001) y lo calcula
    -- la API con MAX(numero)+1; el UNIQUE es la red de contención.
    -- =========================================================================
    IF to_regclass(format('%I.proyecto_qa_observaciones', sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %I.proyecto_qa_observaciones (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
          proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
          seccion_id uuid REFERENCES %I.proyecto_qa_secciones(id) ON DELETE SET NULL,
          numero integer NOT NULL,
          titulo text NOT NULL,
          descripcion text,
          estado text NOT NULL DEFAULT 'pendiente'
            CHECK (estado IN ('pendiente','en_curso','resuelto','verificado','descartado')),
          severidad text NOT NULL DEFAULT 'media'
            CHECK (severidad IN ('bloqueante','alta','media','baja')),
          origen text NOT NULL DEFAULT 'interno'
            CHECK (origen IN ('interno','cliente')),
          url_referencia text,
          asignado_a uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          fecha_limite date,
          resuelto_por uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          resuelto_at timestamptz,
          verificado_por uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          verificado_at timestamptz,
          sort_order integer NOT NULL DEFAULT 0,
          created_by uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_pqobs_numero UNIQUE (empresa_id, proyecto_id, numero),
          CONSTRAINT chk_pqobs_titulo_non_empty CHECK (length(trim(titulo)) > 0)
        )
        $sql$, sch, cat_sch, sch, sch, cat_sch, cat_sch, cat_sch, cat_sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_qa_observaciones (empresa_id, proyecto_id, estado)',
        'ix_pqobs_estado_' || replace(md5(sch::text), '-', '_'), sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_qa_observaciones (empresa_id, proyecto_id, seccion_id, sort_order)',
        'ix_pqobs_seccion_' || replace(md5(sch::text), '-', '_'), sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_qa_observaciones (empresa_id, asignado_a, estado)',
        'ix_pqobs_asignado_' || replace(md5(sch::text), '-', '_'), sch
      );

      IF rls_sch IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.proyecto_qa_observaciones ENABLE ROW LEVEL SECURITY', sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observaciones_select ON %I.proyecto_qa_observaciones FOR SELECT USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observaciones_insert ON %I.proyecto_qa_observaciones FOR INSERT WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observaciones_update ON %I.proyecto_qa_observaciones FOR UPDATE USING (%I.puede_acceder_empresa(empresa_id)) WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observaciones_delete ON %I.proyecto_qa_observaciones FOR DELETE USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
      END IF;

      IF upd_sch IS NOT NULL THEN
        EXECUTE format('CREATE TRIGGER tr_pqobs_updated BEFORE UPDATE ON %I.proyecto_qa_observaciones FOR EACH ROW EXECUTE FUNCTION %I.set_updated_at()', sch, upd_sch);
      END IF;
    END IF;

    -- =========================================================================
    -- proyecto_qa_observacion_archivos (misma forma que proyecto_qa_item_archivos)
    -- =========================================================================
    IF to_regclass(format('%I.proyecto_qa_observacion_archivos', sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %I.proyecto_qa_observacion_archivos (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
          proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
          observacion_id uuid NOT NULL REFERENCES %I.proyecto_qa_observaciones(id) ON DELETE CASCADE,
          nombre text NOT NULL,
          storage_bucket text NOT NULL DEFAULT 'proyectos',
          storage_path text NOT NULL,
          mime_type text,
          size_bytes bigint,
          sort_order integer NOT NULL DEFAULT 0,
          uploaded_by uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT uq_pqoa_storage UNIQUE (empresa_id, storage_bucket, storage_path),
          CONSTRAINT chk_pqoa_nombre_non_empty CHECK (length(trim(nombre)) > 0)
        )
        $sql$, sch, cat_sch, sch, sch, cat_sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_qa_observacion_archivos (empresa_id, observacion_id, sort_order)',
        'ix_pqoa_' || replace(md5(sch::text), '-', '_'), sch
      );

      IF rls_sch IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.proyecto_qa_observacion_archivos ENABLE ROW LEVEL SECURITY', sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observacion_archivos_select ON %I.proyecto_qa_observacion_archivos FOR SELECT USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observacion_archivos_insert ON %I.proyecto_qa_observacion_archivos FOR INSERT WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observacion_archivos_update ON %I.proyecto_qa_observacion_archivos FOR UPDATE USING (%I.puede_acceder_empresa(empresa_id)) WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observacion_archivos_delete ON %I.proyecto_qa_observacion_archivos FOR DELETE USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
      END IF;
    END IF;

    -- =========================================================================
    -- proyecto_qa_observacion_comentarios (hilo dentro de cada observación)
    -- =========================================================================
    IF to_regclass(format('%I.proyecto_qa_observacion_comentarios', sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %I.proyecto_qa_observacion_comentarios (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
          proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
          observacion_id uuid NOT NULL REFERENCES %I.proyecto_qa_observaciones(id) ON DELETE CASCADE,
          texto text NOT NULL,
          autor_id uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_pqoc_texto_non_empty CHECK (length(trim(texto)) > 0)
        )
        $sql$, sch, cat_sch, sch, sch, cat_sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_qa_observacion_comentarios (empresa_id, observacion_id, created_at)',
        'ix_pqoc_' || replace(md5(sch::text), '-', '_'), sch
      );

      IF rls_sch IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.proyecto_qa_observacion_comentarios ENABLE ROW LEVEL SECURITY', sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observacion_comentarios_select ON %I.proyecto_qa_observacion_comentarios FOR SELECT USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observacion_comentarios_insert ON %I.proyecto_qa_observacion_comentarios FOR INSERT WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observacion_comentarios_update ON %I.proyecto_qa_observacion_comentarios FOR UPDATE USING (%I.puede_acceder_empresa(empresa_id)) WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_qa_observacion_comentarios_delete ON %I.proyecto_qa_observacion_comentarios FOR DELETE USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
      END IF;

      IF upd_sch IS NOT NULL THEN
        EXECUTE format('CREATE TRIGGER tr_pqoc_updated BEFORE UPDATE ON %I.proyecto_qa_observacion_comentarios FOR EACH ROW EXECUTE FUNCTION %I.set_updated_at()', sch, upd_sch);
      END IF;
    END IF;

    -- =========================================================================
    -- proyecto_qa_eventos — audit trail compartido: nueva FK + acciones nuevas
    -- =========================================================================
    ev_rel := to_regclass(format('%I.proyecto_qa_eventos', sch));
    IF ev_rel IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = ev_rel
          AND attname = 'observacion_id'
          AND NOT attisdropped
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I.proyecto_qa_eventos ADD COLUMN observacion_id uuid REFERENCES %I.proyecto_qa_observaciones(id) ON DELETE CASCADE',
          sch, sch
        );
        EXECUTE format(
          'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_qa_eventos (empresa_id, observacion_id, created_at DESC)',
          'ix_pqevo_' || replace(md5(sch::text), '-', '_'), sch
        );
      END IF;

      -- Reemplazar el CHECK de `accion` (nombre detectado dinámicamente).
      FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        WHERE con.conrelid = ev_rel
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
          'seccion_creada','seccion_editada','seccion_eliminada'
        ))
        $sql$, sch
      );
    END IF;

    -- =========================================================================
    -- Privilegios — NO sacar de acá ni meter dentro de un IF de creación.
    --
    -- El schema tiene DEFAULT PRIVILEGES definidos *para el rol `postgres`*: las
    -- tablas que crea `postgres` reciben solas los grants a anon/authenticated/
    -- service_role. Pero las migraciones las aplica `supabase_admin`, y las
    -- tablas que crea ese rol nacen con ACL nula — o sea, accesibles únicamente
    -- por su dueño. El resultado es que la API (que usa el service role) recibe
    -- `42501 permission denied` en cada consulta.
    --
    -- Por eso los GRANT van explícitos y fuera del `IF to_regclass(...) IS NULL`:
    -- así una re-ejecución repara tablas que ya existen. Se replica el ACL que
    -- tienen las tablas del checklist: anon solo lectura, el resto CRUD.
    -- =========================================================================
    FOREACH tbl IN ARRAY ARRAY[
      'proyecto_qa_secciones','proyecto_qa_observaciones',
      'proyecto_qa_observacion_archivos','proyecto_qa_observacion_comentarios'
    ]
    LOOP
      IF to_regclass(format('%I.%I', sch, tbl)) IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          EXECUTE format('GRANT SELECT ON %I.%I TO anon', sch, tbl);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO authenticated', sch, tbl);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO service_role', sch, tbl);
        END IF;
      END IF;
    END LOOP;

    -- Realtime opcional (mantiene paridad con el resto del módulo).
    FOREACH tbl IN ARRAY ARRAY[
      'proyecto_qa_secciones','proyecto_qa_observaciones',
      'proyecto_qa_observacion_archivos','proyecto_qa_observacion_comentarios'
    ]
    LOOP
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = sch
            AND tablename = tbl
        ) THEN
          EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I.%I', sch, tbl);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
