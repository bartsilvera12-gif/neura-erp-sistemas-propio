-- =============================================================================
-- Realtime del chat interno
--
-- El chat se suscribía a `chat_interno_mensajes`, la suscripción conectaba sin
-- error… y no llegaba nunca nada: la tabla no estaba en la publicación
-- `supabase_realtime`. Postgres sólo replica lo que está publicado, así que
-- había que recargar la pantalla para ver un mensaje nuevo.
--
-- Se publica con LISTA DE COLUMNAS, no la tabla entera. La replicación no
-- distingue destinatarios por sí sola, y el texto de una conversación interna
-- no tiene por qué viajar por ese canal. Con lo que se publica alcanza para
-- saber QUE pasó algo y en qué sala; el contenido se pide después por la API,
-- que sí verifica que quien pregunta sea miembro.
--
-- Y se enciende RLS con una política de pertenencia: es lo que hace que
-- Realtime le entregue el aviso a los miembros de la sala y a nadie más. El
-- servidor usa service_role, que no pasa por RLS, así que la aplicación no
-- cambia en nada.
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

    -- --- Publicación -------------------------------------------------------
    -- Sin la lista de columnas viajaría `texto` y los adjuntos.
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = sch
         AND tablename = 'chat_interno_mensajes'
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE %I.chat_interno_mensajes (id, sala_id, usuario_id, created_at)',
        sch);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = sch
         AND tablename = 'chat_interno_miembros'
    ) THEN
      -- Para el visto: cuando alguien lee, cambia `ultima_lectura_at`.
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE %I.chat_interno_miembros (id, sala_id, usuario_id, ultima_lectura_at)',
        sch);
    END IF;

    -- --- RLS ---------------------------------------------------------------
    EXECUTE format('ALTER TABLE %I.chat_interno_mensajes ENABLE ROW LEVEL SECURITY', sch);
    EXECUTE format('ALTER TABLE %I.chat_interno_miembros ENABLE ROW LEVEL SECURITY', sch);
    EXECUTE format('ALTER TABLE %I.chat_interno_salas ENABLE ROW LEVEL SECURITY', sch);

    EXECUTE format('DROP POLICY IF EXISTS p_chat_interno_mensajes_miembro ON %I.chat_interno_mensajes', sch);
    EXECUTE format($p$
      CREATE POLICY p_chat_interno_mensajes_miembro ON %I.chat_interno_mensajes
        FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1
            FROM %I.chat_interno_miembros m
            JOIN %I.usuarios u ON u.id = m.usuario_id
           WHERE m.sala_id = chat_interno_mensajes.sala_id
             AND u.auth_user_id = auth.uid()
        ))$p$, sch, sch, sch);

    EXECUTE format('DROP POLICY IF EXISTS p_chat_interno_miembros_miembro ON %I.chat_interno_miembros', sch);
    EXECUTE format($p$
      CREATE POLICY p_chat_interno_miembros_miembro ON %I.chat_interno_miembros
        FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1
            FROM %I.chat_interno_miembros m2
            JOIN %I.usuarios u ON u.id = m2.usuario_id
           WHERE m2.sala_id = chat_interno_miembros.sala_id
             AND u.auth_user_id = auth.uid()
        ))$p$, sch, sch, sch);

    EXECUTE format('DROP POLICY IF EXISTS p_chat_interno_salas_miembro ON %I.chat_interno_salas', sch);
    EXECUTE format($p$
      CREATE POLICY p_chat_interno_salas_miembro ON %I.chat_interno_salas
        FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1
            FROM %I.chat_interno_miembros m
            JOIN %I.usuarios u ON u.id = m.usuario_id
           WHERE m.sala_id = chat_interno_salas.id
             AND u.auth_user_id = auth.uid()
        ))$p$, sch, sch, sch);

    -- Realtime lee la tabla con el rol del suscriptor; sin este GRANT la
    -- política nunca llega a evaluarse y no se entrega nada.
    EXECUTE format('GRANT SELECT ON %I.chat_interno_mensajes TO authenticated', sch);
    EXECUTE format('GRANT SELECT ON %I.chat_interno_miembros TO authenticated', sch);
    EXECUTE format('GRANT SELECT ON %I.chat_interno_salas TO authenticated', sch);
  END LOOP;
END $$;
