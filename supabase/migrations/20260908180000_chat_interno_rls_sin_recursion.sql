-- =============================================================================
-- La política de pertenencia, sin recursión
--
-- La versión anterior preguntaba "¿soy miembro de esta sala?" leyendo
-- `chat_interno_miembros`… que a su vez tiene una política que pregunta lo
-- mismo. Postgres lo corta con "infinite recursion detected in policy".
--
-- Se resuelve con una función SECURITY DEFINER: corre como `postgres`, dueño de
-- las tablas, así que la consulta de adentro no vuelve a pasar por RLS y la
-- pregunta se responde una sola vez.
--
-- `search_path` fijo: una función SECURITY DEFINER sin eso es una puerta para
-- que quien la llame la haga mirar otras tablas.
-- =============================================================================

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

    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION %I.chat_interno_soy_miembro(p_sala uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = %I, public, pg_temp
      AS $body$
        SELECT EXISTS (
          SELECT 1
            FROM chat_interno_miembros m
            JOIN usuarios u ON u.id = m.usuario_id
           WHERE m.sala_id = p_sala
             AND u.auth_user_id = auth.uid()
        )
      $body$
    $f$, sch, sch);

    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.chat_interno_soy_miembro(uuid) TO authenticated', sch);

    EXECUTE format('DROP POLICY IF EXISTS p_chat_interno_mensajes_miembro ON %I.chat_interno_mensajes', sch);
    EXECUTE format($p$
      CREATE POLICY p_chat_interno_mensajes_miembro ON %I.chat_interno_mensajes
        FOR SELECT TO authenticated
        USING (%I.chat_interno_soy_miembro(sala_id))$p$, sch, sch);

    EXECUTE format('DROP POLICY IF EXISTS p_chat_interno_miembros_miembro ON %I.chat_interno_miembros', sch);
    EXECUTE format($p$
      CREATE POLICY p_chat_interno_miembros_miembro ON %I.chat_interno_miembros
        FOR SELECT TO authenticated
        USING (%I.chat_interno_soy_miembro(sala_id))$p$, sch, sch);

    EXECUTE format('DROP POLICY IF EXISTS p_chat_interno_salas_miembro ON %I.chat_interno_salas', sch);
    EXECUTE format($p$
      CREATE POLICY p_chat_interno_salas_miembro ON %I.chat_interno_salas
        FOR SELECT TO authenticated
        USING (%I.chat_interno_soy_miembro(id))$p$, sch, sch);
  END LOOP;
END $$;
