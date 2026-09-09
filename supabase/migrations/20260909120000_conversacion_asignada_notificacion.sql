-- =============================================================================
-- Aviso en la campanita cuando a alguien le cae una conversación en su cola
--
-- Va por TRIGGER y no por código de la aplicación porque una conversación se
-- asigna por muchas puertas: la autoasignación legacy, la RPC de Contact
-- Center, una transferencia manual, una redistribución de campaña. Poner el
-- aviso en cada una es garantizar que alguna quede afuera; en la tabla, no hay
-- forma de asignar sin que se entere.
--
-- El trigger NUNCA puede voltear una asignación: si el aviso falla, se traga el
-- error y la conversación queda asignada igual. Un aviso perdido es un
-- problema; una conversación que no se asigna es otro mucho peor.
-- =============================================================================

-- El tipo nuevo tiene que entrar en el CHECK. `usuario_notificaciones` es de
-- `supabase_admin`: sin SET ROLE el ALTER falla y la migración informa "OK".
SET ROLE supabase_admin;

DO $$
DECLARE
  r   RECORD;
  sch text;
  def text;
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

    CONTINUE WHEN def IS NULL OR def LIKE '%conversacion_asignada%';

    EXECUTE format('ALTER TABLE %I.usuario_notificaciones DROP CONSTRAINT chk_unotif_tipo', sch);
    EXECUTE format(
      $c$ALTER TABLE %I.usuario_notificaciones
         ADD CONSTRAINT chk_unotif_tipo CHECK (tipo = ANY (ARRAY[
           'qa_novedad', 'qa_aprobado', 'qa_rechazado',
           'proyecto_estado_cambio', 'proyecto_entregado',
           'cobro_pendiente', 'comentario_proyecto',
           'chat_interno_mensaje', 'conversacion_asignada'
         ]))$c$,
      sch);
  END LOOP;
END $$;

RESET ROLE;

-- --- La función y el trigger, en cada schema que tenga las dos tablas --------
DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_conversations' AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE c2.relname = 'chat_agents' AND n2.nspname = n.nspname
      )
      AND EXISTS (
        SELECT 1 FROM pg_class c3 JOIN pg_namespace n3 ON n3.oid = c3.relnamespace
        WHERE c3.relname = 'usuario_notificaciones' AND n3.nspname = n.nspname
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION %I.avisar_conversacion_asignada()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = %I, public, pg_temp
      AS $body$
      DECLARE
        v_usuario uuid;
        v_nombre  text;
      BEGIN
        -- Sólo cuando la conversación CAMBIA de dueño y queda con uno.
        IF NEW.assigned_agent_id IS NULL THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
          RETURN NEW;
        END IF;

        SELECT usuario_id INTO v_usuario
          FROM chat_agents WHERE id = NEW.assigned_agent_id;
        IF v_usuario IS NULL THEN RETURN NEW; END IF;

        -- El nombre de quien escribe es lo que hace útil el aviso: sin eso,
        -- "tenés un chat nuevo" obliga a entrar para saber de quién.
        BEGIN
          SELECT COALESCE(NULLIF(TRIM(name), ''), phone_number)
            INTO v_nombre
            FROM chat_contacts WHERE id = NEW.contact_id;
        EXCEPTION WHEN OTHERS THEN
          v_nombre := NULL;
        END;

        INSERT INTO usuario_notificaciones
          (empresa_id, usuario_id, tipo, titulo, cuerpo, metadata)
        VALUES (
          NEW.empresa_id,
          v_usuario,
          'conversacion_asignada',
          'Chat asignado',
          COALESCE(v_nombre, 'Un contacto') || ' entró a tu cola.',
          jsonb_build_object('conversation_id', NEW.id)
        );
        RETURN NEW;
      EXCEPTION WHEN OTHERS THEN
        -- Pase lo que pase, la conversación se asigna. Un aviso perdido es un
        -- problema; una conversación sin dueño es uno mucho peor.
        RETURN NEW;
      END;
      $body$
    $f$, sch, sch);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_avisar_conversacion_asignada ON %I.chat_conversations', sch);
    EXECUTE format($t$
      CREATE TRIGGER trg_avisar_conversacion_asignada
        AFTER INSERT OR UPDATE OF assigned_agent_id ON %I.chat_conversations
        FOR EACH ROW EXECUTE FUNCTION %I.avisar_conversacion_asignada()
    $t$, sch, sch);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
