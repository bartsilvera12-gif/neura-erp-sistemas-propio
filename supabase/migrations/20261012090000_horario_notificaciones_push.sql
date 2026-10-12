-- Horario en el que cada persona acepta notificaciones push.
--
-- Fuera de ese horario el despachador NO manda nada (ver src/lib/cc/horario-notificaciones.ts).
-- Se guarda por usuario: cada uno configura el suyo desde la app.
--
-- Sin fila = sin restricción: se notifica siempre. Por eso `activo` arranca en false incluso
-- cuando alguien guarda un horario sin querer activarlo todavía.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT nspname AS sch FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
      AND EXISTS (
        SELECT 1 FROM pg_class c
        WHERE c.relnamespace = pg_namespace.oid AND c.relname = 'agent_device_tokens'
      )
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.usuario_horario_notificaciones (
        usuario_id  uuid PRIMARY KEY,
        empresa_id  uuid NOT NULL,
        activo      boolean NOT NULL DEFAULT false,
        -- 0 = domingo … 6 = sábado.
        dias        smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
        -- Horas enteras 0-23. Si `hora_desde` > `hora_hasta`, el tramo cruza la medianoche.
        hora_desde  smallint NOT NULL DEFAULT 8,
        hora_hasta  smallint NOT NULL DEFAULT 20,
        updated_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT horario_notif_horas_validas
          CHECK (hora_desde BETWEEN 0 AND 23 AND hora_hasta BETWEEN 0 AND 23)
      )
    $f$, r.sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_horario_notif_empresa ON %I.usuario_horario_notificaciones (empresa_id)',
      r.sch
    );
  END LOOP;
END $$;
