-- Chat interno: fijar y destacar mensajes (menú del mensaje, como WhatsApp).
--
-- Fijar es de la sala: lo ven todos arriba de la conversación.
-- Destacar es personal: cada uno guarda los suyos, los demás no se enteran.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_interno_mensajes' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I.chat_interno_mensajes ADD COLUMN IF NOT EXISTS fijado_at timestamptz', r.sch);
    EXECUTE format('ALTER TABLE %I.chat_interno_mensajes ADD COLUMN IF NOT EXISTS fijado_por uuid', r.sch);
    EXECUTE format('ALTER TABLE %I.chat_interno_mensajes ADD COLUMN IF NOT EXISTS destacado_por uuid[] NOT NULL DEFAULT ''{}''', r.sch);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_interno_mensajes (sala_id, fijado_at DESC) WHERE fijado_at IS NOT NULL',
      'ix_cimsg_fij_' || substr(md5(r.sch::text), 1, 12), r.sch);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_interno_mensajes USING gin (destacado_por)',
      'ix_cimsg_dest_' || substr(md5(r.sch::text), 1, 12), r.sch);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
