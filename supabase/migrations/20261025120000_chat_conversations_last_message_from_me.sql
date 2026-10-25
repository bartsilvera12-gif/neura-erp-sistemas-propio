-- Bandejas "Sin responder" / "No leídos" del inbox, basadas en la dirección del último mensaje.
-- `last_message_from_me` = true si el último mensaje de la conversación lo mandó el negocio
-- (desde el ERP o desde el WhatsApp Web, que el puente Baileys espeja como saliente), false si lo
-- mandó el cliente. Un trigger lo mantiene al día en CADA inserción de mensaje, así cubre todos los
-- caminos (entrante, espejo del web, saliente del ERP, bot) sin tocar la lógica de la app.
--
-- SOLO neura (canal WhatsApp por QR). Idempotente.

ALTER TABLE neura.chat_conversations
  ADD COLUMN IF NOT EXISTS last_message_from_me boolean;

CREATE OR REPLACE FUNCTION neura.bump_last_message_from_me()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Solo actualiza si este mensaje es igual o más nuevo que el último registrado, para no
  -- corromperse con inserciones fuera de orden (backfills, etc.).
  UPDATE neura.chat_conversations
     SET last_message_from_me = NEW.from_me
   WHERE id = NEW.conversation_id
     AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_last_message_from_me ON neura.chat_messages;
CREATE TRIGGER trg_bump_last_message_from_me
AFTER INSERT ON neura.chat_messages
FOR EACH ROW
EXECUTE FUNCTION neura.bump_last_message_from_me();

-- Backfill del histórico desde el último mensaje de cada conversación.
UPDATE neura.chat_conversations cv
   SET last_message_from_me = lm.from_me
  FROM (
    SELECT DISTINCT ON (conversation_id) conversation_id, from_me
      FROM neura.chat_messages
     ORDER BY conversation_id, created_at DESC
  ) lm
 WHERE lm.conversation_id = cv.id
   AND cv.last_message_from_me IS DISTINCT FROM lm.from_me;
