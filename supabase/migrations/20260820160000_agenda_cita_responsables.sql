-- =============================================================================
-- Agenda: varios responsables por cita
--
-- NECESIDAD
--   `agenda_citas.responsable_id` guarda uno solo. Una reunión puede tener
--   varias personas a cargo, y cada una tiene que recibir el recordatorio.
--
-- CAMBIO
--   Tabla nueva `agenda_cita_responsables` (cita_id + usuario_id). Es ADITIVA:
--   no toca datos ni columnas existentes. `agenda_citas.responsable_id` se
--   mantiene como responsable PRINCIPAL, así todo lo que ya lee esa columna
--   (filtros, disponibilidad, anti-doble-reserva) sigue funcionando igual
--   mientras se despliega el código nuevo.
--
--   Se backfillea con el responsable actual de cada cita, para que después del
--   deploy ninguna cita quede sin responsables en la tabla nueva.
--
-- DESCUBRIMIENTO DE SCHEMAS
--   Por PRESENCIA de `agenda_citas`, no por una lista fija de nombres: en esta
--   instancia el schema de datos se llama `neura` y no entraría en el patrón
--   `public|zentra_erp|er_*|erp_*` que usó la migración original del módulo.
--
-- GRANTs
--   Las tablas nuevas las crea `supabase_admin` y nacen sin ACL: sin GRANT
--   explícito la API responde 42501. Se aplican igual que en el resto del
--   módulo, tolerando que la tabla pertenezca a otro rol.
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
    WHERE c.relname = 'agenda_citas'
      AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;

    IF to_regclass(format('%I.agenda_cita_responsables', sch)) IS NULL THEN
      EXECUTE format(
        $sql$
        CREATE TABLE %1$I.agenda_cita_responsables (
          cita_id    uuid NOT NULL REFERENCES %1$I.agenda_citas(id) ON DELETE CASCADE,
          -- Sin FK a usuarios: igual que el resto del módulo, que no usa FK
          -- cross-schema hacia el catálogo. La integridad la da la API + RLS.
          usuario_id uuid NOT NULL,
          empresa_id uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (cita_id, usuario_id)
        )
        $sql$,
        sch
      );
      RAISE NOTICE 'Schema %: agenda_cita_responsables creada.', sch;
    END IF;

    -- "Mis citas" filtra por usuario: sin este índice sería un seq scan sobre
    -- toda la tabla en cada carga de la agenda.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_agenda_cita_resp_usuario
         ON %I.agenda_cita_responsables (empresa_id, usuario_id)',
      sch
    );

    -- Backfill: el responsable principal de cada cita entra como responsable.
    -- ON CONFLICT lo hace repetible sin duplicar.
    EXECUTE format(
      $sql$
      INSERT INTO %1$I.agenda_cita_responsables (cita_id, usuario_id, empresa_id)
      SELECT c.id, c.responsable_id, c.empresa_id
      FROM %1$I.agenda_citas c
      WHERE c.responsable_id IS NOT NULL
      ON CONFLICT (cita_id, usuario_id) DO NOTHING
      $sql$,
      sch
    );

    -- ------------------------------------------------------------------
    -- RLS + GRANTs. Requieren ser dueño de la tabla; si pertenece a otro
    -- rol se avisa y se sigue, en vez de abortar toda la migración.
    -- ------------------------------------------------------------------
    BEGIN
      EXECUTE format('ALTER TABLE %I.agenda_cita_responsables ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        'DROP POLICY IF EXISTS agenda_cita_resp_all ON %I.agenda_cita_responsables',
        sch
      );
      EXECUTE format(
        'CREATE POLICY agenda_cita_resp_all ON %I.agenda_cita_responsables
           FOR ALL USING (public.puede_acceder_empresa(empresa_id))
           WITH CHECK (public.puede_acceder_empresa(empresa_id))',
        sch
      );

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON %I.agenda_cita_responsables TO authenticated',
          sch
        );
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON %I.agenda_cita_responsables TO service_role',
          sch
        );
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE
        'Schema %: RLS/GRANTs de agenda_cita_responsables omitidos (la tabla pertenece a otro rol).',
        sch;
    END;
  END LOOP;
END $$;
