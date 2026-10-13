-- =============================================================================
-- Comisiones — Matriz 2D (Revenue × Recurrencia → %). SOLO schema `neura`.
-- Modelo "sin sueldo base": la comisión = revenue × % de la celda, donde la celda
-- sale de cruzar el tramo de REVENUE (fila) con el de RECURRENCIA (columna).
-- Gate: se cobra solo si revenue >= revenue_min Y recurrencia >= recurrencia_min.
-- Idempotente. Referencias locales (neura.*). Drift-safe: tablas nuevas solo en neura;
-- el código gatea por presencia + por `modo_calculo` de la config.
-- Aplicar: node scripts/apply-migration-file-pg.cjs <este archivo>  (o vía SSH psql)
-- =============================================================================

-- Config de la matriz (una fila por empresa + política).
CREATE TABLE IF NOT EXISTS neura.comision_matriz_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  politica_id      uuid,                        -- opcional: liga a comision_politicas
  activo           boolean NOT NULL DEFAULT false,   -- si true → el motor usa la matriz
  revenue_min      numeric NOT NULL DEFAULT 15000000,
  recurrencia_min  numeric NOT NULL DEFAULT 500000,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_comision_matriz_config_empresa UNIQUE (empresa_id)
);

-- Celdas de la matriz: una fila por (revenue_desde, recurrencia_desde) → porcentaje.
-- "desde" = piso del tramo (se cae en el tramo alcanzado). Arriba del máximo se usa el
-- último tramo (lo resuelve el calculador, no hace falta fila extra).
CREATE TABLE IF NOT EXISTS neura.comision_matriz (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  revenue_desde      numeric NOT NULL,          -- piso de revenue (ej 15000000)
  recurrencia_desde  numeric NOT NULL,          -- piso de recurrencia (ej 500000)
  porcentaje         numeric NOT NULL DEFAULT 0, -- % sobre el revenue (ej 2.5 = 2,5%)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_comision_matriz_celda UNIQUE (empresa_id, revenue_desde, recurrencia_desde)
);

CREATE INDEX IF NOT EXISTS ix_comision_matriz_empresa ON neura.comision_matriz (empresa_id);

ALTER TABLE neura.comision_matriz_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE neura.comision_matriz ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comision_matriz_config','comision_matriz'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON neura.%I', t, t);
    EXECUTE format('CREATE POLICY %I_select ON neura.%I FOR SELECT USING (neura.puede_acceder_empresa(empresa_id))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON neura.%I', t, t);
    EXECUTE format('CREATE POLICY %I_insert ON neura.%I FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON neura.%I', t, t);
    EXECUTE format('CREATE POLICY %I_update ON neura.%I FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON neura.%I', t, t);
    EXECUTE format('CREATE POLICY %I_delete ON neura.%I FOR DELETE USING (neura.puede_acceder_empresa(empresa_id))', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%I_updated ON neura.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%I_updated BEFORE UPDATE ON neura.%I FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at()', t, t);
  END LOOP;
END $$;
