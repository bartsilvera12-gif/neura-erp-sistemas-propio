-- =============================================================================
-- QA: la fecha límite de una observación pasa a llevar hora
--
-- NECESIDAD
--   `fecha_limite` es `date`, así que sólo guarda el día. Sin hora no se puede
--   avisar "faltan 2 horas para el vencimiento", que es lo que se pidió.
--
-- CAMBIO
--   `date` -> `timestamptz`. Las fechas que ya existieran quedan a las 00:00 de
--   su día en hora de Paraguay (no en UTC: a las 00:00 UTC serían las 21:00 del
--   día anterior allá, y el vencimiento se adelantaría un día).
--
-- RIESGO
--   Nulo en datos: al aplicarla no había NINGUNA observación con fecha límite
--   cargada. La conversión igual está escrita para no perder nada si en algún
--   tenant hubiera valores.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
  tipo text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_qa_observaciones' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;

    SELECT data_type INTO tipo
    FROM information_schema.columns
    WHERE table_schema = sch
      AND table_name = 'proyecto_qa_observaciones'
      AND column_name = 'fecha_limite';

    -- Idempotente: si ya es timestamptz no se vuelve a convertir.
    IF tipo = 'date' THEN
      EXECUTE format(
        $sql$
        ALTER TABLE %I.proyecto_qa_observaciones
          ALTER COLUMN fecha_limite TYPE timestamptz
          USING (fecha_limite::timestamp AT TIME ZONE 'America/Asuncion')
        $sql$,
        sch
      );
      RAISE NOTICE 'Schema %: fecha_limite convertida a timestamptz.', sch;
    ELSE
      RAISE NOTICE 'Schema %: fecha_limite ya es % — sin cambios.', sch, tipo;
    END IF;

    -- Los avisos de vencimiento barren por fecha dentro de una ventana corta.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_pqo_fecha_limite
         ON %I.proyecto_qa_observaciones (empresa_id, fecha_limite)
         WHERE fecha_limite IS NOT NULL',
      sch
    );
  END LOOP;
END $$;
