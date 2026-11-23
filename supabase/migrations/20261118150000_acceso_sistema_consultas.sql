-- =============================================================================
-- Qué ERPs ya escuchan el botón Bloquear / Desbloquear
--
-- Un ERP recién pasa a obedecer el botón cuando se le deploya la versión que
-- consulta `/api/public/acceso-sistema`; antes de eso, apretar Bloquear no
-- cambia nada en el cliente. Para que el panel no mienta, el endpoint anota
-- acá cada dominio que pregunta (a lo sumo una vez cada 5 minutos por dominio)
-- y la pestaña Acceso muestra el botón solo si alguno de los dominios del
-- proyecto consultó en los últimos 7 días. Si no, avisa que la primera vez
-- hay que activarlo por código.
--
-- Aditiva e idempotente. SOLO schema neura.
-- =============================================================================

CREATE TABLE IF NOT EXISTS neura.acceso_sistema_consultas (
  host text PRIMARY KEY,
  ultima_consulta timestamptz NOT NULL DEFAULT now()
);

-- Solo la API (service role) la lee y escribe.
ALTER TABLE neura.acceso_sistema_consultas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON neura.acceso_sistema_consultas FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON neura.acceso_sistema_consultas FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON neura.acceso_sistema_consultas TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
