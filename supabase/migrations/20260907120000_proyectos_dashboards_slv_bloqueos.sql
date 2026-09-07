-- =============================================================================
-- Dashboards de Proyectos (Ejecutivo y PM) — mínimo schema necesario
--
-- Tres cosas, todas nullable y con default, para no tocar un solo dato existente:
--
--   1. `proyectos.bloqueo_tipo` — hoy sólo existe `bloqueado` (boolean) y
--      `bloqueo_motivo` (texto libre). El dashboard tiene que clasificar los
--      bloqueos en Cliente / Interno / Tercero, y clasificar texto libre no es
--      una regla de negocio: es adivinar. Se agrega la columna estructurada y
--      el motivo queda como está.
--
--   2. `proyecto_slv_objetivos` — catálogo por empresa del objetivo de horas
--      técnicas según el tipo de trabajo (corrección menor, cambio medio, web
--      estándar…). Va como tabla y no como constante en el código para que
--      Dirección pueda cambiar los valores sin un deploy.
--
--   3. `proyectos.slv_objetivo_id` — qué objetivo aplica a ESE proyecto. Si
--      queda en NULL se resuelve por el tipo de proyecto, así que los proyectos
--      que ya existen siguen midiéndose sin que nadie los toque.
--
-- Idempotente y multi-schema, como el resto de las migraciones del módulo.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
  eid uuid;
  rec RECORD;
  objetivos jsonb := '[
    {"codigo":"correccion_menor","nombre":"Corrección menor","horas":4,"orden":10},
    {"codigo":"cambio_menor","nombre":"Cambio menor","horas":8,"orden":20},
    {"codigo":"cambio_medio","nombre":"Cambio medio","horas":16,"orden":30},
    {"codigo":"web_estandar","nombre":"Web estándar","horas":24,"orden":40},
    {"codigo":"erp_estandar","nombre":"ERP estándar","horas":40,"orden":50},
    {"codigo":"desarrollo_mayor","nombre":"Desarrollo mayor","horas":80,"orden":60}
  ]'::jsonb;
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

    -- 1) Clasificación del bloqueo -------------------------------------------
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS bloqueo_tipo text',
      sch
    );
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'chk_proyectos_bloqueo_tipo'
        AND conrelid = format('%I.proyectos', sch)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.proyectos
           ADD CONSTRAINT chk_proyectos_bloqueo_tipo
           CHECK (bloqueo_tipo IS NULL OR bloqueo_tipo IN (''cliente'', ''interno'', ''tercero''))',
        sch
      );
    END IF;

    -- 2) Catálogo de objetivos de SLV técnico --------------------------------
    EXECUTE format(
      $sql$
      CREATE TABLE IF NOT EXISTS %I.proyecto_slv_objetivos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        codigo text NOT NULL,
        nombre text NOT NULL,
        horas numeric(8,2) NOT NULL CHECK (horas > 0),
        sort_order integer NOT NULL DEFAULT 0,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_proyecto_slv_objetivos_empresa_codigo UNIQUE (empresa_id, codigo)
      )
      $sql$,
      sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_slv_objetivos (empresa_id, activo)',
      'ix_pso_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    -- Las tablas nuevas nacen sin ACL para los roles de la API.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.proyecto_slv_objetivos TO authenticated', sch);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.proyecto_slv_objetivos TO service_role', sch);
    EXECUTE format('GRANT SELECT ON %I.proyecto_slv_objetivos TO anon', sch);

    -- 3) Objetivo elegido por proyecto ---------------------------------------
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS slv_objetivo_id uuid',
      sch
    );
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_proyectos_slv_objetivo'
        AND conrelid = format('%I.proyectos', sch)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.proyectos
           ADD CONSTRAINT fk_proyectos_slv_objetivo
           FOREIGN KEY (slv_objetivo_id) REFERENCES %I.proyecto_slv_objetivos(id) ON DELETE SET NULL',
        sch, sch
      );
    END IF;

    -- Semilla del catálogo, una vez por empresa que ya tenga proyectos.
    FOR eid IN EXECUTE format('SELECT DISTINCT empresa_id FROM %I.proyectos', sch)
    LOOP
      FOR rec IN SELECT * FROM jsonb_array_elements(objetivos)
      LOOP
        EXECUTE format(
          $ins$
          INSERT INTO %I.proyecto_slv_objetivos (empresa_id, codigo, nombre, horas, sort_order)
          SELECT $1, $2, $3, ($4)::numeric, ($5)::int
          WHERE NOT EXISTS (
            SELECT 1 FROM %I.proyecto_slv_objetivos o
            WHERE o.empresa_id = $1 AND o.codigo = $2
          )
          $ins$,
          sch, sch
        ) USING
          eid,
          rec.value->>'codigo',
          rec.value->>'nombre',
          rec.value->>'horas',
          rec.value->>'orden';
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- PostgREST cachea el esquema: sin esto la API responde 400 "could not find
-- column in schema cache" para `bloqueo_tipo` / `slv_objetivo_id`.
NOTIFY pgrst, 'reload schema';
