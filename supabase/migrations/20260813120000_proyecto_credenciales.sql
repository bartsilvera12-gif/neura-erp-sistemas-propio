-- =============================================================================
-- Módulo Proyectos — Credenciales
--
-- Grupos de credenciales asociados a un proyecto (hosting, panel, FTP, correo,
-- etc.). Cada fila es un grupo: nombre + url + usuario + contraseña.
--
-- La contraseña se guarda en claro a propósito: el caso de uso es "copiar y
-- pegar" en el panel externo, así que tiene que ser recuperable. El control de
-- acceso es el de siempre (empresa_id + RLS + módulo Proyectos en la API).
--
-- Se replica en todo schema con `proyectos`. El schema de catálogo
-- (empresas, usuarios) se detecta dinámicamente (neura | zentra_erp | public).
-- =============================================================================

DO $$
DECLARE
  r        RECORD;
  sch      text;
  cat_sch  text;
  rls_sch  text;
  upd_sch  text;
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

    IF to_regclass(format('%I.proyecto_credenciales', sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %I.proyecto_credenciales (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
          proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
          nombre text NOT NULL,
          url text,
          usuario text,
          password text,
          notas text,
          sort_order integer NOT NULL DEFAULT 0,
          created_by uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          updated_by uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_pcred_nombre_non_empty CHECK (length(trim(nombre)) > 0)
        )
        $sql$, sch, cat_sch, sch, cat_sch, cat_sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_credenciales (empresa_id, proyecto_id, sort_order, created_at)',
        'ix_pcred_' || replace(md5(sch::text), '-', '_'), sch
      );

      IF rls_sch IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.proyecto_credenciales ENABLE ROW LEVEL SECURITY', sch);
        EXECUTE format('CREATE POLICY proyecto_credenciales_select ON %I.proyecto_credenciales FOR SELECT USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_credenciales_insert ON %I.proyecto_credenciales FOR INSERT WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_credenciales_update ON %I.proyecto_credenciales FOR UPDATE USING (%I.puede_acceder_empresa(empresa_id)) WITH CHECK (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch, rls_sch);
        EXECUTE format('CREATE POLICY proyecto_credenciales_delete ON %I.proyecto_credenciales FOR DELETE USING (%I.puede_acceder_empresa(empresa_id))', sch, rls_sch);
      END IF;

      IF upd_sch IS NOT NULL THEN
        EXECUTE format('CREATE TRIGGER tr_pcred_updated BEFORE UPDATE ON %I.proyecto_credenciales FOR EACH ROW EXECUTE FUNCTION %I.set_updated_at()', sch, upd_sch);
      END IF;
    END IF;

    -- =========================================================================
    -- Privilegios — fuera del IF de creación a propósito.
    --
    -- Las migraciones las aplica `supabase_admin` y las tablas que crea ese rol
    -- nacen con ACL nula (los DEFAULT PRIVILEGES del schema son para `postgres`).
    -- Sin GRANT explícito la API responde `42501 permission denied`. Al estar
    -- afuera, una re-ejecución repara tablas ya existentes.
    --
    -- A diferencia del resto del módulo, `anon` NO recibe SELECT: son secretos.
    -- =========================================================================
    IF to_regclass(format('%I.proyecto_credenciales', sch)) IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON %I.proyecto_credenciales FROM anon', sch);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.proyecto_credenciales TO authenticated', sch);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.proyecto_credenciales TO service_role', sch);
      END IF;
    END IF;
  END LOOP;

  PERFORM pg_notify('pgrst', 'reload schema');
END $$;
