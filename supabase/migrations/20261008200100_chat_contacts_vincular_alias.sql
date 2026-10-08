-- Función: `neura.vincular_contacto_como_alias(alias_id, real_id)`.
--
-- Vincula el contacto `alias_id` como alias permanente del `real_id`. En vez de
-- borrar el contacto alias (como hacía el merge destructivo), lo deja vivo con
-- `alias_de_contact_id = real_id`. Esto garantiza que mensajes futuros que lleguen
-- con el mismo phone_number del alias se enruten al real automáticamente.
--
-- Además unifica el historial: para cada canal donde el alias tenía conversación,
-- mueve mensajes + eventos a la conversación del real (crea una si no existía),
-- combina last_message_at/status, y borra la conv vacía del alias. Esto evita que
-- queden dos ventanas con la misma persona en el inbox.
--
-- Idempotente: si `alias_id` ya está apuntando a `real_id`, no hace nada
-- destructivo (puede volver a correr el merge de convs pero no se duplica).
--
-- Validaciones:
--  - alias_id y real_id deben existir y pertenecer a la misma empresa.
--  - alias_id ≠ real_id.
--  - real_id no puede ser él mismo un alias (sin cadenas).

CREATE OR REPLACE FUNCTION neura.vincular_contacto_como_alias(
  p_alias_id uuid,
  p_real_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_alias_empresa uuid;
  v_real_empresa uuid;
  v_real_es_alias uuid;
  v_alias_conv uuid;
  v_real_conv uuid;
  v_canal uuid;
  v_resumen jsonb := '[]'::jsonb;
  v_msgs_total int := 0;
  v_canales_mergeados int := 0;
BEGIN
  IF p_alias_id IS NULL OR p_real_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ids_requeridos');
  END IF;
  IF p_alias_id = p_real_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'alias_igual_a_real');
  END IF;

  SELECT empresa_id INTO v_alias_empresa FROM neura.chat_contacts WHERE id = p_alias_id;
  SELECT empresa_id, alias_de_contact_id INTO v_real_empresa, v_real_es_alias
    FROM neura.chat_contacts WHERE id = p_real_id;

  IF v_alias_empresa IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'alias_no_existe'); END IF;
  IF v_real_empresa IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'real_no_existe'); END IF;
  IF v_alias_empresa <> v_real_empresa THEN RETURN jsonb_build_object('ok', false, 'error', 'empresas_distintas'); END IF;
  IF v_real_es_alias IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'real_ya_es_alias', 'detalle',
      'El contacto que elegiste como "real" ya es alias de otro. Elegí ese otro directamente.');
  END IF;

  -- Para cada canal donde el alias tiene conv: mergear la conv del alias en la del real.
  FOR v_canal, v_alias_conv IN
    SELECT channel_id, id FROM neura.chat_conversations WHERE contact_id = p_alias_id
  LOOP
    SELECT id INTO v_real_conv FROM neura.chat_conversations
      WHERE contact_id = p_real_id AND channel_id = v_canal LIMIT 1;

    IF v_real_conv IS NULL THEN
      -- No hay conv del real en ese canal: reasignamos la del alias directamente.
      UPDATE neura.chat_conversations SET contact_id = p_real_id WHERE id = v_alias_conv;
      v_resumen := v_resumen || jsonb_build_object('canal', v_canal, 'accion', 'reasignada', 'conv', v_alias_conv);
    ELSE
      -- Ambas existen: mover hijos de la conv alias a la conv real y borrar la alias.
      -- Cerrar flow activo del alias si el real ya tiene uno (UNIQUE sobre
      -- conversation_id WHERE status='active').
      UPDATE neura.chat_flow_sessions SET status = 'closed'
       WHERE conversation_id = v_alias_conv AND status = 'active'
         AND EXISTS (SELECT 1 FROM neura.chat_flow_sessions
                      WHERE conversation_id = v_real_conv AND status = 'active');

      UPDATE neura.chat_messages SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      GET DIAGNOSTICS v_msgs_total = ROW_COUNT;

      UPDATE neura.chat_flow_sessions SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.chat_flow_data SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.chat_flow_events SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.chat_routing_events SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.chat_comprobante_validaciones SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.agent_notification_events SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.chat_conversation_pipeline_events SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.chat_conversation_closures SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.sorteo_entradas SET chat_conversation_id = v_real_conv WHERE chat_conversation_id = v_alias_conv;
      UPDATE neura.sorteo_revendedor_clicks SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      UPDATE neura.sorteo_ticket_deliveries SET conversation_id = v_real_conv WHERE conversation_id = v_alias_conv;
      DELETE FROM neura.chat_conversation_attribution WHERE conversation_id = v_alias_conv;

      -- Combinar metadata en la conv del real.
      UPDATE neura.chat_conversations r SET
        last_message_at = GREATEST(COALESCE(r.last_message_at, '-infinity'::timestamptz),
          COALESCE((SELECT last_message_at FROM neura.chat_conversations WHERE id = v_alias_conv), '-infinity'::timestamptz)),
        last_message_preview = CASE
          WHEN (SELECT last_message_at FROM neura.chat_conversations WHERE id = v_alias_conv) IS NOT NULL
           AND (r.last_message_at IS NULL
                OR (SELECT last_message_at FROM neura.chat_conversations WHERE id = v_alias_conv) > r.last_message_at)
          THEN (SELECT last_message_preview FROM neura.chat_conversations WHERE id = v_alias_conv)
          ELSE r.last_message_preview END,
        status = CASE
          WHEN r.status = 'open' OR (SELECT status FROM neura.chat_conversations WHERE id = v_alias_conv) = 'open' THEN 'open'
          WHEN r.status = 'pending' OR (SELECT status FROM neura.chat_conversations WHERE id = v_alias_conv) = 'pending' THEN 'pending'
          ELSE 'closed' END,
        updated_at = now()
      WHERE r.id = v_real_conv;

      DELETE FROM neura.chat_conversations WHERE id = v_alias_conv;
      v_resumen := v_resumen || jsonb_build_object('canal', v_canal, 'accion', 'mergeada',
        'conv_alias', v_alias_conv, 'conv_real', v_real_conv, 'msgs_movidos', v_msgs_total);
    END IF;
    v_canales_mergeados := v_canales_mergeados + 1;
  END LOOP;

  -- Mover referencias a nivel contacto (no borramos el alias — lo marcamos).
  UPDATE neura.chat_conversation_attribution SET contact_id = p_real_id WHERE contact_id = p_alias_id;
  UPDATE neura.chat_campaign_recipients SET contact_id = p_real_id WHERE contact_id = p_alias_id;

  -- Y la clave del fix: dejamos el contacto alias vivo pero marcado. Nuevos
  -- mensajes con ese phone_number encuentran la fila, saveIncomingMessage ve
  -- `alias_de_contact_id` y usa el real como contact_id.
  UPDATE neura.chat_contacts SET
    alias_de_contact_id = p_real_id,
    updated_at = now()
  WHERE id = p_alias_id;

  RETURN jsonb_build_object(
    'ok', true,
    'alias_id', p_alias_id,
    'real_id', p_real_id,
    'canales', v_canales_mergeados,
    'detalle', v_resumen
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION neura.vincular_contacto_como_alias(uuid, uuid) IS
  'Vincula un contacto como alias permanente de otro. Fusiona historial de conversaciones '
  'en todos los canales. No borra el alias: lo deja marcado para que mensajes futuros '
  'con su phone_number sigan al real automáticamente.';
