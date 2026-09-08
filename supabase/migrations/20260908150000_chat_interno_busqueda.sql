-- =============================================================================
-- Índice para el buscador del chat
--
-- El buscador hace `ILIKE '%texto%'`, y eso no puede usar un índice btree: el
-- comodín al principio impide cualquier búsqueda por prefijo. Un índice GIN de
-- trigramas sí lo resuelve.
--
-- Hoy hay pocos mensajes y un recorrido completo no se nota. Se agrega ahora
-- porque el costo es nulo y el momento en que empieza a doler es justo cuando
-- ya nadie quiere tocar la tabla.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_interno_mensajes' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_interno_mensajes USING gin (texto gin_trgm_ops)',
      'ix_cimtxt_' || md5(sch::text), sch);
  END LOOP;
END $$;
