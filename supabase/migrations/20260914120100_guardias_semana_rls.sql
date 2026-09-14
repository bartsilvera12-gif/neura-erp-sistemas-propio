-- =============================================================================
-- guardias_semana: cerrar el acceso directo
--
-- La tabla se creó (20260911120000) con permisos para `authenticated` y sin
-- RLS. Las tablas comparables del ERP tienen RLS activo. Sin él, un usuario
-- autenticado podía leer guardias de cualquier empresa consultando PostgREST
-- directo con su token.
--
-- La app nunca la lee así: la API usa service role, que no se ve afectado. Por
-- eso esto no cambia nada de lo que se ve en pantalla.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'guardias_semana' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I.guardias_semana ENABLE ROW LEVEL SECURITY', r.sch);
    EXECUTE format('REVOKE ALL ON %I.guardias_semana FROM anon, authenticated', r.sch);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.guardias_semana TO service_role', r.sch);
  END LOOP;
END $$;
