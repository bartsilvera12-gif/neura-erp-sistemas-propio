-- Horario en el que cada persona acepta notificaciones push, con una franja POR DÍA.
--
-- Fuera de su franja el despachador NO manda nada (ver src/lib/cc/horario-notificaciones.ts).
--
-- `franjas` es un objeto { "<día>": [desde, hasta] } con el día 0 = domingo … 6 = sábado y
-- horas enteras 0-23. Un día que no está en el objeto no recibe notificaciones. Si `desde` es
-- mayor que `hasta`, la franja sigue hasta esa hora del día siguiente (guardias de noche).
--
-- Se guarda como un objeto y no como siete columnas porque cada día tiene su propio tramo y
-- la lista cambia de forma seguido; con columnas, cada ajuste sería una migración.
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
        franjas     jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch);

    -- Versión anterior de esta misma tabla: tenía un único horario para todos los días.
    EXECUTE format(
      'ALTER TABLE %I.usuario_horario_notificaciones ADD COLUMN IF NOT EXISTS franjas jsonb NOT NULL DEFAULT ''{}''::jsonb',
      r.sch
    );
  END LOOP;
END $$;
