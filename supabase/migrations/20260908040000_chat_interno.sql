-- =============================================================================
-- Chat interno del equipo
--
-- Mensajería entre usuarios de la empresa: grupos, conversaciones directas,
-- archivos y audios. Es un módulo NUEVO y aparte del chat omnicanal
-- (`chat_conversations`), que modela algo distinto: conversaciones con clientes
-- por WhatsApp, con canales, colas y atribución de campañas. Mezclarlos habría
-- obligado a llenar de columnas nulas ambas mitades.
--
-- Tres tablas:
--   · salas    — el grupo o la conversación directa.
--   · miembros — quién está en cada sala y hasta dónde leyó.
--   · mensajes — el contenido, con sus adjuntos en jsonb.
--
-- El borrado de un mensaje es lógico (`eliminado_at`): en una conversación de
-- equipo importa que quede el hueco, no que el mensaje desaparezca sin rastro.
-- =============================================================================

DO $$
DECLARE
  r       RECORD;
  sch     text;
  cat_sch text;
BEGIN
  SELECT n.nspname INTO cat_sch
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'usuarios' AND c.relkind = 'r'
  ORDER BY CASE n.nspname WHEN 'neura' THEN 1 WHEN 'zentra_erp' THEN 2 WHEN 'public' THEN 3 ELSE 4 END
  LIMIT 1;
  IF cat_sch IS NULL THEN RAISE EXCEPTION 'No se encontró schema con `usuarios`'; END IF;

  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyectos' AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I.chat_interno_salas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        tipo text NOT NULL DEFAULT 'grupo' CHECK (tipo IN ('grupo', 'directo')),
        nombre text,
        descripcion text,
        creado_por uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
        ultimo_mensaje_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        -- Un grupo necesita nombre; una conversación directa se nombra sola con
        -- el nombre de la otra persona, y pedirle uno sería ruido.
        CONSTRAINT chk_chat_sala_nombre CHECK (tipo <> 'grupo' OR length(trim(coalesce(nombre,''))) > 0)
      )
    $sql$, sch, cat_sch);

    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I.chat_interno_miembros (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sala_id uuid NOT NULL REFERENCES %I.chat_interno_salas(id) ON DELETE CASCADE,
        usuario_id uuid NOT NULL REFERENCES %I.usuarios(id) ON DELETE CASCADE,
        rol text NOT NULL DEFAULT 'miembro' CHECK (rol IN ('admin', 'miembro')),
        ultima_lectura_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_chat_miembro UNIQUE (sala_id, usuario_id)
      )
    $sql$, sch, sch, cat_sch);

    EXECUTE format($sql$
      CREATE TABLE IF NOT EXISTS %I.chat_interno_mensajes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        sala_id uuid NOT NULL REFERENCES %I.chat_interno_salas(id) ON DELETE CASCADE,
        usuario_id uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
        texto text,
        adjuntos jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        editado_at timestamptz,
        eliminado_at timestamptz,
        -- Un mensaje vacío no existe: o dice algo o trae un archivo.
        CONSTRAINT chk_chat_mensaje_contenido CHECK (
          length(trim(coalesce(texto, ''))) > 0
          OR (adjuntos IS NOT NULL AND jsonb_array_length(adjuntos) > 0)
        )
      )
    $sql$, sch, sch, cat_sch);

    -- La bandeja ordena por actividad y la conversación pagina hacia atrás.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_interno_salas (empresa_id, ultimo_mensaje_at DESC)',
      'ix_cis_' || replace(md5(sch::text), '-', '_'), sch);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_interno_miembros (usuario_id)',
      'ix_cim_' || replace(md5(sch::text), '-', '_'), sch);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.chat_interno_mensajes (sala_id, created_at DESC)',
      'ix_cimsg_' || replace(md5(sch::text), '-', '_'), sch);

    -- Las tablas nuevas nacen sin ACL para los roles de la API.
    FOREACH sch IN ARRAY ARRAY[sch] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.chat_interno_salas TO authenticated, service_role', sch);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.chat_interno_miembros TO authenticated, service_role', sch);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.chat_interno_mensajes TO authenticated, service_role', sch);
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
