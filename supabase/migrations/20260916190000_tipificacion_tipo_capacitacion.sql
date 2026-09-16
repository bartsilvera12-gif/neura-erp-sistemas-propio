-- =============================================================================
-- Tipificación: tipo de gestión "Capacitación"
--
-- Al tipificar una capacitación se agenda la sesión en Agenda (agenda_citas,
-- tipo 'capacitacion', vinculada al cliente). La cita la crea la API; acá sólo
-- se habilita el valor en el CHECK de tipo_gestion.
--
-- Aditiva e idempotente: la lista permitida = la oficial + 'Capacitación' +
-- cualquier valor que ya exista en la tabla.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

DO $mig$
DECLARE
  s text;
  permitidos text;
  def text;
BEGIN
  FOR s IN
    SELECT n.nspname
    FROM pg_namespace n
    WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r' AND c.relname = 'tipificaciones')
    ORDER BY 1
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    WHERE c.conname = 'tipificaciones_tipo_gestion_check'
      AND c.conrelid = format('%I.tipificaciones', s)::regclass;
    CONTINUE WHEN def IS NOT NULL AND position(U&'Capacitaci\00F3n' IN def) > 0;

    EXECUTE format($q$
      SELECT string_agg(quote_literal(v), ', ' ORDER BY v)
      FROM (
        SELECT unnest(ARRAY['Consulta', 'Reclamo', 'Seguimiento', 'Promesa de pago',
                            U&'Soporte t\00E9cnico', 'Cambio plan', 'Error', 'Cambio',
                            U&'Capacitaci\00F3n']) AS v
        UNION
        SELECT DISTINCT tipo_gestion FROM %I.tipificaciones WHERE tipo_gestion IS NOT NULL
      ) x
    $q$, s) INTO permitidos;
    EXECUTE format('ALTER TABLE %I.tipificaciones DROP CONSTRAINT IF EXISTS tipificaciones_tipo_gestion_check', s);
    EXECUTE format('ALTER TABLE %I.tipificaciones ADD CONSTRAINT tipificaciones_tipo_gestion_check CHECK (tipo_gestion IN (%s))', s, permitidos);
  END LOOP;
END
$mig$;
