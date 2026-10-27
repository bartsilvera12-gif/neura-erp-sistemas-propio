-- La cola de una conversación siempre sigue a la cola del agente que la tiene asignada.
-- Antes había un camino (reasignación directa a un PM, p. ej.) que cambiaba
-- assigned_agent_id SIN mover queue_id, y el chat quedaba visible en una cola a la que
-- ese agente no pertenece (ej: un chat en "ventas" manejado por una PM de "project manager").
-- Este trigger lo corrige en el SERVIDOR, así cubre TODOS los caminos (asignación directa,
-- transferencia a cola, toma manual, alta de conversación nueva) sin tocar la app.
--
-- Regla: al setear/cambiar assigned_agent_id o queue_id, si el chat queda asignado a un
-- agente que TIENE cola, la cola del chat se fuerza a la del agente. Si el agente no tiene
-- cola, o la conversación queda sin asignar, la cola NO se toca (el chat espera en su cola).
--
-- SOLO neura. Idempotente.

CREATE OR REPLACE FUNCTION neura.align_queue_to_agent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_q uuid;
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL THEN
    SELECT queue_id INTO v_q FROM neura.chat_agents WHERE id = NEW.assigned_agent_id;
    IF v_q IS NOT NULL AND NEW.queue_id IS DISTINCT FROM v_q THEN
      NEW.queue_id := v_q;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_align_queue_to_agent ON neura.chat_conversations;
CREATE TRIGGER trg_align_queue_to_agent
BEFORE INSERT OR UPDATE OF assigned_agent_id, queue_id ON neura.chat_conversations
FOR EACH ROW
EXECUTE FUNCTION neura.align_queue_to_agent();

-- Corrección por única vez del histórico: alinear cada conversación a la cola de su agente
-- (donde el agente tiene cola).
UPDATE neura.chat_conversations cv
   SET queue_id = a.queue_id
  FROM neura.chat_agents a
 WHERE a.id = cv.assigned_agent_id
   AND a.queue_id IS NOT NULL
   AND cv.queue_id IS DISTINCT FROM a.queue_id;
