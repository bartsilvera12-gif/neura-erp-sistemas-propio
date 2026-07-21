-- =============================================================================
-- Realtime para el tenant `neura`: agregar las tablas de chat a la publicación.
-- =============================================================================
-- La migración original (20250329140000_chat_realtime_publication.sql) solo
-- agregó `public.chat_messages` / `public.chat_conversations`. En el deploy
-- single_client, el schema de datos es `neura`, así que sus tablas nunca
-- quedaron en `supabase_realtime` → el inbox del ERP no recibía eventos en
-- tiempo real y dependía solo del polling de respaldo (30-60s) → "actualiza tarde".
--
-- Idempotente y ACOTADO a `neura`: no toca `public`, `elevate` ni ningún otro
-- schema, y no elimina nada. Solo AGREGA (ALTER PUBLICATION ... ADD TABLE).
-- Tras aplicarla, reiniciar el contenedor de Realtime para que re-lea la
-- publicación (o esperar a su re-scan periódico).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'neura' AND c.relname = 'chat_messages'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'neura' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE neura.chat_messages;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'neura' AND c.relname = 'chat_conversations'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'neura' AND tablename = 'chat_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE neura.chat_conversations;
  END IF;
END $$;
