-- =============================================================================
-- Guardias: registro de intercambios principal ↔ suplente (schema neura)
--
-- Proceso de Gestión de Soporte v1.4 §11.3: cuando el principal no puede, se
-- activa el suplente y el cambio debe conservar fecha, motivo y responsable.
-- El intercambio en sí se hace sobre guardias_semana; acá queda la traza.
--
-- Sólo el schema `neura`. Aditiva e idempotente.
-- Solo API (service role): RLS sin políticas y sin acceso anon/authenticated.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS neura.guardias_intercambios (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL,
  semana_inicio          date NOT NULL,
  principal_anterior_id  uuid,
  principal_nuevo_id     uuid,
  motivo                 text,
  realizado_por          uuid,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_guardias_intercambios_semana
  ON neura.guardias_intercambios (empresa_id, semana_inicio, created_at DESC);

ALTER TABLE neura.guardias_intercambios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON neura.guardias_intercambios FROM anon, authenticated;
GRANT SELECT, INSERT ON neura.guardias_intercambios TO service_role;

NOTIFY pgrst, 'reload schema';
