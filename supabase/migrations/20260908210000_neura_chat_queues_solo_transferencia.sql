-- =============================================================================
-- Cola "solo transferencias" — SOLO para el schema del cliente neura.
--
-- Una cola con `solo_transferencia = true` NO recibe chats nuevos por reparto
-- automático; solo recibe conversaciones que un agente le TRANSFIERE manualmente
-- (caso de uso: cola de Project Managers que reciben derivaciones de comerciales).
--
-- IMPORTANTE: esta función es EXCLUSIVA de neura. NO se aplica a otros schemas
-- (cada ERP/cliente es único). Por eso el ALTER está acotado a `neura.chat_queues`
-- y guardado con IF EXISTS: en instalaciones donde el schema `neura` no exista,
-- esta migración es un no-op. El código de la app lee esta columna de forma
-- drift-safe, así que su ausencia en cualquier otro schema no afecta a nadie.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_queues' AND c.relkind = 'r' AND n.nspname = 'neura'
  ) THEN
    ALTER TABLE neura.chat_queues
      ADD COLUMN IF NOT EXISTS solo_transferencia boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Sin esto la API sigue contestando 400 "could not find column in schema cache".
NOTIFY pgrst, 'reload schema';
