-- =============================================================================
-- Buscador del inbox: sin tildes y con índices
--
-- Hoy la búsqueda es `ILIKE '%texto%'` sobre el nombre del contacto, el
-- teléfono y la vista previa del último mensaje. Dos problemas:
--
--  · Las tildes cuentan. Buscar "jose" no encuentra a "José", y nadie escribe
--    con tilde en un buscador.
--  · No hay ningún índice que sirva: un comodín al principio descarta cualquier
--    btree, así que cada búsqueda recorre las tablas enteras.
--
-- Se resuelve con `unaccent` y trigramas. `unaccent()` a secas es STABLE y no
-- se puede indexar; la forma de dos argumentos, con el diccionario explícito,
-- sí es determinista, y por eso el envoltorio puede declararse IMMUTABLE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
DECLARE
  r    RECORD;
  sch  text;
  dicc text;
BEGIN
  -- El diccionario vive donde se instaló la extensión.
  SELECT n.nspname INTO dicc
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';
  IF dicc IS NULL THEN dicc := 'public'; END IF;

  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_contacts' AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE c2.relname = 'chat_conversations' AND n2.nspname = n.nspname)
    ORDER BY 1
  LOOP
    sch := r.sch;

    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION %I.sin_tildes(t text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      AS $body$
        SELECT lower(%I.unaccent('%I.unaccent'::regdictionary, t))
      $body$
    $f$, sch, dicc, dicc);

    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.sin_tildes(text) TO authenticated, service_role', sch);

    -- Trigramas: es lo único que puede resolver un comodín al principio.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_contacts
         USING gin (%I.sin_tildes(name) gin_trgm_ops)',
      'ix_cc_nombre_trgm_' || md5(sch), sch, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_contacts
         USING gin (phone_normalized gin_trgm_ops)',
      'ix_cc_tel_trgm_' || md5(sch), sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_conversations
         USING gin (%I.sin_tildes(last_message_preview) gin_trgm_ops)',
      'ix_conv_preview_trgm_' || md5(sch), sch, sch);
  END LOOP;
END $$;
