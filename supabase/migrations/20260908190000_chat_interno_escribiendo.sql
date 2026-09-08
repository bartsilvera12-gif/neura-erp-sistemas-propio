-- =============================================================================
-- "Está escribiendo…" sin depender de WebSockets
--
-- El aviso ideal viaja por Realtime y no toca la base. Pero el WebSocket de
-- Realtime no llega: el proxy que está delante reescribe la cabecera
-- `Connection` y el servicio rechaza el upgrade. Hasta que eso se arregle, el
-- chat se sostiene consultando, y para eso el "estoy escribiendo" necesita
-- dónde apoyarse.
--
-- Una marca de tiempo por persona y por sala alcanza: quien escribió hace
-- menos de unos segundos está escribiendo. No hace falta un "ya no escribo",
-- que además nunca llega cuando alguien cierra la pestaña.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_interno_miembros' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    EXECUTE format(
      'ALTER TABLE %I.chat_interno_miembros ADD COLUMN IF NOT EXISTS escribiendo_at timestamptz',
      sch);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
