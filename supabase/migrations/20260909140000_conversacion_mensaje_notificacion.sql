-- =============================================================================
-- Aviso cuando entra un mensaje en una conversación que ya es tuya
--
-- El trigger anterior avisa cuando una conversación CAMBIA de dueño. Pero el
-- caso habitual no es ese: es un cliente que vuelve a escribir en un chat que
-- ya estaba asignado, y ahí `assigned_agent_id` no cambia, así que no pasaba
-- nada. Quien estaba en otra pantalla no se enteraba nunca.
--
-- Se agrupa por conversación mientras el aviso siga sin leer: un cliente que
-- manda cinco mensajes seguidos es UNA conversación que espera respuesta, no
-- cinco avisos. Mismo patrón que `qa_novedad`, con su índice único parcial.
--
-- Este trigger corre en el camino de entrada de CADA mensaje de WhatsApp. Se
-- traga cualquier error a propósito: perder un aviso es un problema; perder el
-- mensaje del cliente es inaceptable.
-- =============================================================================

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

    CONTINUE WHEN def IS NULL OR def LIKE '%conversacion_mensaje%';

    EXECUTE format('ALTER TABLE %I.usuario_notificaciones DROP CONSTRAINT chk_unotif_tipo', sch);
    EXECUTE format(
      $c$ALTER TABLE %I.usuario_notificaciones
         ADD CONSTRAINT chk_unotif_tipo CHECK (tipo = ANY (ARRAY[
           'qa_novedad', 'qa_aprobado', 'qa_rechazado',
           'proyecto_estado_cambio', 'proyecto_entregado',
           'cobro_pendiente', 'comentario_proyecto',
           'chat_interno_mensaje', 'conversacion_asignada',
           'conversacion_mensaje'
         ]))$c$,
      sch);
  END LOOP;
END $$;

RESET ROLE;

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_messages' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
                  WHERE c2.relname = 'chat_conversations' AND n2.nspname = n.nspname)
      AND EXISTS (SELECT 1 FROM pg_class c3 JOIN pg_namespace n3 ON n3.oid = c3.relnamespace
                  WHERE c3.relname = 'chat_agents' AND n3.nspname = n.nspname)
      AND EXISTS (SELECT 1 FROM pg_class c4 JOIN pg_namespace n4 ON n4.oid = c4.relnamespace
                  WHERE c4.relname = 'usuario_notificaciones' AND n4.nspname = n.nspname)
    ORDER BY 1
  LOOP
    sch := r.sch;

    -- El índice que hace posible agrupar: un aviso sin leer por conversación.
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.usuario_notificaciones
         (empresa_id, usuario_id, evento_id)
         WHERE tipo = ''conversacion_mensaje'' AND leida_at IS NULL',
      'uq_unotif_conv_' || md5(sch), sch);

    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION %I.avisar_mensaje_de_cliente()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = %I, public, pg_temp
      AS $body$
      DECLARE
        v_agente  uuid;
        v_contact uuid;
        v_usuario uuid;
        v_nombre  text;
        v_texto   text;
      BEGIN
        -- Sólo lo que ESCRIBE el cliente. Lo que manda el equipo no se avisa.
        IF NEW.from_me IS TRUE THEN RETURN NEW; END IF;
        IF COALESCE(NEW.sender_type, 'contact') <> 'contact' THEN RETURN NEW; END IF;

        SELECT assigned_agent_id, contact_id INTO v_agente, v_contact
          FROM chat_conversations WHERE id = NEW.conversation_id;
        IF v_agente IS NULL THEN RETURN NEW; END IF;

        SELECT usuario_id INTO v_usuario FROM chat_agents WHERE id = v_agente;
        IF v_usuario IS NULL THEN RETURN NEW; END IF;

        SELECT COALESCE(NULLIF(TRIM(name), ''), phone_number) INTO v_nombre
          FROM chat_contacts WHERE id = v_contact;

        -- Un extracto corto: lo suficiente para decidir si hay que entrar.
        v_texto := NULLIF(TRIM(LEFT(REGEXP_REPLACE(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 90)), '');
        IF v_texto IS NULL THEN
          v_texto := CASE NEW.message_type
                       WHEN 'image' THEN 'Envió una imagen'
                       WHEN 'audio' THEN 'Envió un audio'
                       WHEN 'video' THEN 'Envió un video'
                       WHEN 'document' THEN 'Envió un archivo'
                       ELSE 'Mensaje nuevo'
                     END;
        END IF;

        INSERT INTO usuario_notificaciones
          (empresa_id, usuario_id, tipo, titulo, cuerpo, evento_id, agrupadas, metadata)
        VALUES (
          NEW.empresa_id, v_usuario, 'conversacion_mensaje',
          COALESCE(v_nombre, 'Un contacto'), v_texto,
          NEW.conversation_id, 1,
          jsonb_build_object('conversation_id', NEW.conversation_id)
        )
        ON CONFLICT (empresa_id, usuario_id, evento_id)
          WHERE tipo = 'conversacion_mensaje' AND leida_at IS NULL
        DO UPDATE SET
          -- Cinco mensajes seguidos son UNA conversación esperando respuesta.
          agrupadas  = usuario_notificaciones.agrupadas + 1,
          cuerpo     = EXCLUDED.cuerpo,
          created_at = now(),
          updated_at = now();

        RETURN NEW;
      EXCEPTION WHEN OTHERS THEN
        -- Perder un aviso es un problema; perder el mensaje del cliente, no se
        -- discute. Este trigger jamas puede voltear la entrada de un mensaje.
        RETURN NEW;
      END;
      $body$
    $f$, sch, sch);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_avisar_mensaje_de_cliente ON %I.chat_messages', sch);
    EXECUTE format($t$
      CREATE TRIGGER trg_avisar_mensaje_de_cliente
        AFTER INSERT ON %I.chat_messages
        FOR EACH ROW EXECUTE FUNCTION %I.avisar_mensaje_de_cliente()
    $t$, sch, sch);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
