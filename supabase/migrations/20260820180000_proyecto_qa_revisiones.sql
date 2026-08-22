-- =============================================================================
-- Registro de pasadas por QA, para medir el tiempo de respuesta de cada QA.
--
-- NECESIDAD
--   `proyecto_estado_historial` ya guarda cuánto estuvo un proyecto en la
--   columna QA, pero no guarda QUIÉN lo estaba revisando. Sin eso no se le puede
--   medir el tiempo de respuesta a una persona concreta.
--
-- CAMBIO
--   Tabla nueva `proyecto_qa_revisiones`: una fila por pasada por QA. Se abre al
--   entrar el proyecto a la columna QA y se cierra al salir, guardando el tiempo
--   en HORARIO LABORAL (mismo reloj que el contador de Tareas del equipo) y con
--   qué resultado salió. Es ADITIVA: no toca datos ni columnas existentes.
--
--   Un proyecto puede pasar por QA varias veces (rebota, se corrige, vuelve):
--   por eso es una fila por pasada y no una columna en `proyectos`.
--
-- DESCUBRIMIENTO DE SCHEMAS
--   Por presencia de `proyectos`, no por una lista fija de nombres.
--
-- GRANTs
--   Las tablas nuevas nacen sin ACL: sin GRANT explícito la API da 42501.
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
    ORDER BY 1
  LOOP
    sch := r.sch;

    IF to_regclass(format('%I.proyecto_qa_revisiones', sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %1$I.proyecto_qa_revisiones (
          id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id        uuid NOT NULL,
          proyecto_id       uuid NOT NULL REFERENCES %1$I.proyectos(id) ON DELETE CASCADE,
          -- Sin FK al catálogo de usuarios: el resto del módulo tampoco usa FK
          -- cross-schema. Puede ser NULL si el proyecto entró a QA sin QA asignada.
          qa_responsable_id uuid,
          entrada_at        timestamptz NOT NULL DEFAULT now(),
          salida_at         timestamptz,
          -- Milisegundos de HORARIO LABORAL entre entrada y salida. Se calcula
          -- al cerrar, con el mismo reloj que el contador del tablero: entrar un
          -- viernes 16:30 y salir el lunes 8:30 son 60 minutos, no 64 horas.
          ms_laborables     bigint,
          -- Con qué veredicto salió: 'aprobado' (QA lo dio por bueno),
          -- 'cambios' (lo devolvió), o NULL si salió de QA sin veredicto
          -- (alguien lo movió de columna a mano).
          resultado         text,
          estado_salida_id  uuid REFERENCES %1$I.proyecto_estados(id) ON DELETE SET NULL,
          created_at        timestamptz NOT NULL DEFAULT now(),
          updated_at        timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT chk_qa_rev_rango CHECK (salida_at IS NULL OR salida_at >= entrada_at),
          CONSTRAINT chk_qa_rev_resultado CHECK (
            resultado IS NULL OR resultado IN ('aprobado', 'cambios')
          )
        )
        $sql$,
        sch
      );
      RAISE NOTICE 'Schema %: proyecto_qa_revisiones creada.', sch;
    END IF;

    -- Un proyecto no puede tener dos pasadas por QA abiertas a la vez. Esto es
    -- lo que hace que reabrir sea idempotente: si el código intenta abrir una
    -- segunda, la base lo impide en vez de dejar el registro duplicado.
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_rev_abierta
         ON %I.proyecto_qa_revisiones (proyecto_id) WHERE salida_at IS NULL',
      sch
    );

    -- El reporte se lee "por QA, en un rango de fechas".
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_qa_rev_responsable
         ON %I.proyecto_qa_revisiones (empresa_id, qa_responsable_id, salida_at)',
      sch
    );

    BEGIN
      EXECUTE format('ALTER TABLE %I.proyecto_qa_revisiones ENABLE ROW LEVEL SECURITY', sch);
      EXECUTE format(
        'DROP POLICY IF EXISTS proyecto_qa_revisiones_all ON %I.proyecto_qa_revisiones',
        sch
      );

      -- `puede_acceder_empresa` vive dentro de cada schema de tenant, no en
      -- `public`. Si faltara, la tabla queda con RLS y sin policy: sin acceso es
      -- el lado seguro para fallar, y service_role la sigue leyendo.
      IF to_regprocedure(format('%I.puede_acceder_empresa(uuid)', sch)) IS NOT NULL THEN
        EXECUTE format(
          'CREATE POLICY proyecto_qa_revisiones_all ON %1$I.proyecto_qa_revisiones
             FOR ALL USING (%1$I.puede_acceder_empresa(empresa_id))
             WITH CHECK (%1$I.puede_acceder_empresa(empresa_id))',
          sch
        );
      ELSE
        RAISE NOTICE 'Schema %: sin puede_acceder_empresa(); queda con RLS y sin policy.', sch;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE ON %I.proyecto_qa_revisiones TO authenticated',
          sch
        );
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON %I.proyecto_qa_revisiones TO service_role',
          sch
        );
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE
        'Schema %: RLS/GRANTs de proyecto_qa_revisiones omitidos (la tabla pertenece a otro rol).',
        sch;
    END;
  END LOOP;
END $$;
