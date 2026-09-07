-- =============================================================================
-- Chat interno — responder, reaccionar, mencionar, y avisar en la campanita
--
-- Tres columnas nuevas en `chat_interno_mensajes`:
--   · responde_a  — el mensaje citado. `ON DELETE SET NULL`: si el original se
--                   borra de verdad, la respuesta sobrevive sin la cita.
--   · reacciones  — {emoji: [usuario_id, ...]}. En jsonb y no en una tabla
--                   aparte porque siempre se leen junto al mensaje y nunca se
--                   consultan solas; una tabla sumaría un join a cada página.
--   · menciones   — ids de los mencionados con @, no sus nombres: los nombres
--                   cambian y se repiten.
--
-- Y se amplía el CHECK de tipos de notificación para que el chat pueda avisar.
-- `usuario_notificaciones` es de `supabase_admin`, así que el ALTER va con
-- SET ROLE: sin eso la migración informa "OK" y el CHECK no cambia.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_interno_mensajes' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    EXECUTE format(
      'ALTER TABLE %I.chat_interno_mensajes
         ADD COLUMN IF NOT EXISTS responde_a uuid REFERENCES %I.chat_interno_mensajes(id) ON DELETE SET NULL',
      sch, sch);
    EXECUTE format(
      'ALTER TABLE %I.chat_interno_mensajes ADD COLUMN IF NOT EXISTS reacciones jsonb', sch);
    EXECUTE format(
      'ALTER TABLE %I.chat_interno_mensajes ADD COLUMN IF NOT EXISTS menciones jsonb', sch);

    -- El buscador filtra por texto dentro de una sala.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_interno_mensajes (sala_id) WHERE eliminado_at IS NULL',
      'ix_cimv_' || replace(md5(sch::text), '-', '_'), sch);
  END LOOP;
END $$;

-- La tabla es de `supabase_admin` y `postgres` es miembro: sin SET ROLE el
-- ALTER falla por permisos, en silencio para quien mira el resultado.
SET ROLE supabase_admin;

DO $$
DECLARE
  r    RECORD;
  sch  text;
  def  text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'usuario_notificaciones' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
    WHERE conname = 'chk_unotif_tipo'
      AND conrelid = format('%I.usuario_notificaciones', sch)::regclass;

    CONTINUE WHEN def IS NULL OR def LIKE '%chat_interno_mensaje%';

    EXECUTE format('ALTER TABLE %I.usuario_notificaciones DROP CONSTRAINT chk_unotif_tipo', sch);
    EXECUTE format(
      $c$ALTER TABLE %I.usuario_notificaciones
         ADD CONSTRAINT chk_unotif_tipo CHECK (tipo = ANY (ARRAY[
           'qa_novedad', 'qa_aprobado', 'qa_rechazado',
           'proyecto_estado_cambio', 'proyecto_entregado',
           'cobro_pendiente', 'comentario_proyecto',
           'chat_interno_mensaje'
         ]))$c$,
      sch);
  END LOOP;
END $$;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
