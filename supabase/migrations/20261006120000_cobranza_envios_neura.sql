-- =============================================================================
-- Cobranzas — "Cobranza enviada" (seguimiento manual por cliente y mes).
-- SOLO schema `neura`. Idempotente. Referencias locales (neura.*).
-- Una marca por cliente + período (YYYY-MM): la lista solo consulta el mes
-- en curso, así la marca se "resetea" sola cada mes.
-- Aplicar: node scripts/apply-migration-file-pg.cjs <este archivo>  (o vía SSH psql)
-- =============================================================================

CREATE TABLE IF NOT EXISTS neura.cobranza_envios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  cliente_id         uuid NOT NULL REFERENCES neura.clientes(id) ON DELETE CASCADE,
  periodo            text NOT NULL CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  marcado_por        uuid REFERENCES neura.usuarios(id) ON DELETE SET NULL,
  marcado_por_email  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cobranza_envios_cliente_periodo UNIQUE (empresa_id, cliente_id, periodo)
);

CREATE INDEX IF NOT EXISTS ix_cobranza_envios_periodo
  ON neura.cobranza_envios (empresa_id, periodo);

ALTER TABLE neura.cobranza_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cobranza_envios_select ON neura.cobranza_envios;
CREATE POLICY cobranza_envios_select ON neura.cobranza_envios
  FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS cobranza_envios_insert ON neura.cobranza_envios;
CREATE POLICY cobranza_envios_insert ON neura.cobranza_envios
  FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS cobranza_envios_update ON neura.cobranza_envios;
CREATE POLICY cobranza_envios_update ON neura.cobranza_envios
  FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id))
  WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS cobranza_envios_delete ON neura.cobranza_envios;
CREATE POLICY cobranza_envios_delete ON neura.cobranza_envios
  FOR DELETE USING (neura.puede_acceder_empresa(empresa_id));

DROP TRIGGER IF EXISTS tr_cobranza_envios_updated ON neura.cobranza_envios;
CREATE TRIGGER tr_cobranza_envios_updated BEFORE UPDATE ON neura.cobranza_envios
  FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();
