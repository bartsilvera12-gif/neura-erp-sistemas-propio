-- =============================================================================
-- Bloquear / desbloquear el sistema de un cliente desde su proyecto
--
-- Hasta ahora suspender el ERP de un cliente por falta de pago era tocar un flag
-- en su repo, pushear y esperar el redeploy. Con esto el estado vive acá:
--
--   · proyectos.acceso_dominios      — los dominios donde responde el sistema
--                                      del cliente (ej. `giovanni.neura.com.py`).
--                                      El ERP pregunta por su propio host.
--   · proyectos.acceso_suspendido    — true = el ERP muestra "acceso suspendido
--                                      por falta de pago" y su API responde 402.
--   · proyectos.acceso_suspendido_at / _por — desde cuándo y quién.
--
-- Cada ERP consulta `GET /api/public/acceso-sistema?host=<su host>` (cacheado
-- un minuto) y si no puede consultar deja entrar: un corte de este sistema
-- nunca bloquea a los clientes.
--
-- proyecto_acceso_eventos guarda cada bloqueo, desbloqueo y cambio de dominios
-- con su autor, para saber después quién suspendió a quién.
--
-- Los ids de usuario/empresa van sin FK: el catálogo (empresas + usuarios) puede
-- vivir en otro schema según la instalación, como en las demás migraciones.
--
-- Aditiva e idempotente. SOLO schema neura.
-- =============================================================================

ALTER TABLE neura.proyectos
  ADD COLUMN IF NOT EXISTS acceso_dominios text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS acceso_suspendido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acceso_suspendido_at timestamptz,
  ADD COLUMN IF NOT EXISTS acceso_suspendido_por uuid;

CREATE INDEX IF NOT EXISTS ix_proyectos_acceso_dominios
  ON neura.proyectos USING gin (acceso_dominios);

CREATE TABLE IF NOT EXISTS neura.proyecto_acceso_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  proyecto_id uuid NOT NULL REFERENCES neura.proyectos(id) ON DELETE CASCADE,
  accion text NOT NULL CHECK (accion IN ('bloquear', 'desbloquear', 'dominios')),
  dominios text[] NOT NULL DEFAULT '{}',
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_proyecto_acceso_eventos_proyecto
  ON neura.proyecto_acceso_eventos (proyecto_id, created_at DESC);

-- Solo la API (service role) la lee y escribe.
ALTER TABLE neura.proyecto_acceso_eventos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON neura.proyecto_acceso_eventos FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON neura.proyecto_acceso_eventos FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON neura.proyecto_acceso_eventos TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
