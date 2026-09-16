-- =============================================================================
-- Soporte: la numeración de tickets arranca en 1 (se muestra como #0001)
--
-- Antes el primer ticket era el #1001. Ahora el correlativo por empresa arranca
-- en 1; la pantalla lo muestra con cuatro dígitos.
--
-- Sólo el schema `neura`. Idempotente.
-- =============================================================================

SET client_encoding = 'UTF8';

CREATE OR REPLACE FUNCTION neura.soporte_tickets_asignar_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'neura', 'pg_temp'
AS $function$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero <= 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('soporte_tickets:' || NEW.empresa_id::text));
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM soporte_tickets WHERE empresa_id = NEW.empresa_id;
  END IF;
  RETURN NEW;
END
$function$;
