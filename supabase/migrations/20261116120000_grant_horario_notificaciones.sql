-- Fix de ACL: `usuario_horario_notificaciones` nació SIN GRANT.
--
-- La migración 20261012090000_horario_notificaciones_push.sql creó la tabla (la crea
-- `supabase_admin`) pero NO concedió permisos a `service_role` → PostgREST devolvía 403
-- (visto en prod 16-nov) y la feature de horario de notificaciones push quedaba rota.
--
-- Es una tabla SOLO-API accedida únicamente por `service_role` (server-side):
--   - src/lib/cc/horario-notificaciones.ts (dispatch, SupabaseAdmin)
--   - src/app/api/mobile/asesor/notificaciones/horario/route.ts (GET/PUT, requireEmpresaTenantServiceRole)
-- Ningún cliente `authenticated`/`anon` la toca. `service_role` tiene `bypassrls`, así que:
--   GRANT a service_role + RLS ON sin políticas (authenticated/anon sin grant => sin fuga entre tenants).
--
-- Loop sobre los schemas que TIENEN la tabla (= tenants con el módulo de push), igual que la
-- migración que la creó. Idempotente.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'usuario_horario_notificaciones'
      AND c.relkind = 'r'
      AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON %I.usuario_horario_notificaciones TO service_role',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.usuario_horario_notificaciones ENABLE ROW LEVEL SECURITY',
      r.sch
    );
  END LOOP;
END $$;
