-- =============================================================================
-- Cola "solo transferencias"
--
-- Una cola marcada con `solo_transferencia = true` NO recibe chats nuevos por
-- reparto automático (nunca es destino de enrutamiento de conversaciones
-- entrantes). Solo recibe conversaciones que un agente le TRANSFIERE de forma
-- manual. Caso de uso: la cola de Project Managers, que reciben chats derivados
-- por los comerciales, pero a quienes el bot / reparto nunca les asigna un chat
-- inicial.
--
-- La garantía primaria de exclusión del reparto sigue siendo `receives_new_chats`
-- por agente; este flag a nivel de cola es el refuerzo (y el marcador de la UI):
-- una cola así se saca del pool de colas ruteables en la asignación automática.
--
-- Se agrega en TODOS los esquemas que tengan `chat_queues`: el tenant de esta
-- instancia vive en `neura`; en otras instancias vive en otro esquema.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_queues' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.chat_queues ADD COLUMN IF NOT EXISTS solo_transferencia boolean NOT NULL DEFAULT false',
      r.sch
    );
  END LOOP;
END $$;

-- Sin esto la API sigue contestando 400 "could not find column in schema cache".
NOTIFY pgrst, 'reload schema';
