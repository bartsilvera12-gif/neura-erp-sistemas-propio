-- ============================================================================
-- Fase 5.1 — Avisos de la campanita para el flujo de solicitudes de compra.
--
-- Amplía `chk_unotif_tipo` con el tipo `compra_solicitud`, que emiten las rutas
-- del flujo (nueva solicitud, aprobada, rechazada, pago confirmado) para avisar
-- a quien le toca actuar.
--
-- SOLO schema `neura` (regla: no aplicar loops a los schemas de otras empresas).
-- `usuario_notificaciones` pertenece a `supabase_admin`: ampliar su CHECK como
-- `postgres` falla con 42501, así que se hace con SET ROLE supabase_admin
-- (postgres es miembro). Idempotente: DROP IF EXISTS + ADD con la lista completa.
-- ============================================================================

DO $$
DECLARE
  soy_miembro boolean;
BEGIN
  IF to_regclass('neura.usuario_notificaciones') IS NULL THEN
    RAISE NOTICE 'neura.usuario_notificaciones no existe: nada que hacer.';
    RETURN;
  END IF;

  SELECT pg_has_role(current_user, 'supabase_admin', 'MEMBER') INTO soy_miembro;
  IF NOT COALESCE(soy_miembro, false) THEN
    RAISE NOTICE 'El rol actual no es miembro de supabase_admin; el CHECK queda sin ampliar. Ejecutá "GRANT supabase_admin TO postgres;" y reaplicá.';
    RETURN;
  END IF;

  SET LOCAL ROLE supabase_admin;

  ALTER TABLE neura.usuario_notificaciones DROP CONSTRAINT IF EXISTS chk_unotif_tipo;
  ALTER TABLE neura.usuario_notificaciones
    ADD CONSTRAINT chk_unotif_tipo CHECK (tipo IN (
      'qa_novedad', 'qa_aprobado', 'qa_rechazado',
      'proyecto_estado_cambio', 'proyecto_entregado',
      'cobro_pendiente', 'comentario_proyecto',
      'chat_interno_mensaje', 'conversacion_asignada', 'conversacion_mensaje',
      'soporte_revision',
      'compra_solicitud'
    ));

  RAISE NOTICE 'neura: chk_unotif_tipo ampliado con compra_solicitud.';
END $$;

-- Que PostgREST/Realtime vea el cambio sin reiniciar nada.
SELECT pg_notify('pgrst', 'reload schema');
