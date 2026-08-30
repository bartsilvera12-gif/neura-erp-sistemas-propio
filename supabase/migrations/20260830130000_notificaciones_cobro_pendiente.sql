-- ============================================================================
-- Notificación de cobro pendiente de aprobación (Conciliación bancaria).
--
-- Amplía `chk_unotif_tipo` con el tipo que emiten los botones de cobro cuando
-- crean un cobro PENDIENTE:
--   * `cobro_pendiente` — un cobro por transferencia entró a la cola y espera
--     que un administrador lo apruebe/rechace en Conciliación bancaria.
--
-- Sólo toca el CHECK: la tabla, RLS, policies, índices y GRANTs los crea
-- 20260813160000_usuario_notificaciones.sql y siguen valiendo.
--
-- REQUIERE SER DUEÑO DE LA TABLA. En esta instancia `usuario_notificaciones`
-- pertenece a `supabase_admin`, así que aplicar esto como `postgres` falla con
-- `42501 must be owner of table`. Se resuelve con UNA línea ejecutada por un
-- superusuario: GRANT supabase_admin TO postgres;
-- Igual que las migraciones previas, no se aborta si falta el permiso: se avisa
-- por NOTICE y el resto queda intacto, para poder re-aplicar después.
-- ============================================================================

DO $$
DECLARE
  r         RECORD;
  sch       text;
  soy_dueno boolean;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'usuario_notificaciones'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    SELECT pg_get_userbyid(c.relowner) = current_user INTO soy_dueno
    FROM pg_class c
    WHERE c.oid = format('%I.usuario_notificaciones', sch)::regclass;

    IF NOT COALESCE(soy_dueno, false) THEN
      RAISE NOTICE
        'Schema %: usuario_notificaciones pertenece a otro rol; el CHECK de tipo queda sin ampliar. Ejecutá "GRANT supabase_admin TO postgres;" como superusuario y volvé a aplicar esta migración.',
        sch;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.usuario_notificaciones DROP CONSTRAINT IF EXISTS chk_unotif_tipo',
      sch
    );
    EXECUTE format(
      $sql$
      ALTER TABLE %I.usuario_notificaciones
      ADD CONSTRAINT chk_unotif_tipo CHECK (tipo IN (
        'qa_novedad', 'qa_aprobado', 'qa_rechazado',
        'proyecto_estado_cambio', 'proyecto_entregado',
        'cobro_pendiente'
      ))
      $sql$, sch
    );

    RAISE NOTICE 'Schema %: chk_unotif_tipo ampliado con cobro_pendiente.', sch;
  END LOOP;
END $$;
