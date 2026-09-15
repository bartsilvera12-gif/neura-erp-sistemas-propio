-- Chats finalizados: permiso para ver los cierres de otros usuarios.
--
-- Un asesor (rol omnicanal 'agente') ve solo sus finalizadas. Esta tabla le
-- suma, SOLO en Conversaciones finalizadas, los cierres de otros usuarios
-- puntuales: aparece el selector de agente y puede abrir el detalle de esos
-- chats cerrados. No cambia su rol, ni el inbox en vivo, ni lo que puede
-- responder o tomar.
--
-- Aditiva e idempotente, en cada schema que ya tiene el módulo de chat.
-- Solo API (service role): RLS sin políticas y sin acceso para anon/authenticated.

DO $mig$
DECLARE
  s text;
BEGIN
  FOR s IN
    SELECT n.nspname
    FROM pg_namespace n
    WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r' AND c.relname = 'chat_supervisor_agents')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r' AND c.relname = 'chat_conversations')
    ORDER BY 1
  LOOP
    EXECUTE format($t$
      CREATE TABLE IF NOT EXISTS %I.chat_finalizados_visibilidad (
        empresa_id      uuid NOT NULL,
        usuario_id      uuid NOT NULL,   -- quien mira
        ver_usuario_id  uuid NOT NULL,   -- de quien puede ver los finalizados
        created_at      timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (empresa_id, usuario_id, ver_usuario_id),
        CONSTRAINT chat_finalizados_visibilidad_distintos CHECK (usuario_id <> ver_usuario_id)
      )
    $t$, s);
    EXECUTE format('ALTER TABLE %I.chat_finalizados_visibilidad ENABLE ROW LEVEL SECURITY', s);
    EXECUTE format('REVOKE ALL ON %I.chat_finalizados_visibilidad FROM anon, authenticated', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.chat_finalizados_visibilidad TO service_role', s);
  END LOOP;
END
$mig$;

NOTIFY pgrst, 'reload schema';
