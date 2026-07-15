-- =============================================================================
-- FASE 2 — Motor contable (asientos) + configuración + períodos. SOLO schema `neura`.
-- Idempotente. No borra datos. No contabiliza históricos. No toca otros schemas.
-- =============================================================================

BEGIN;

-- ── 1) Cabecera de asientos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.asientos_contables (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  numero_asiento        text NOT NULL,
  fecha_contable        date NOT NULL,
  glosa                 text,
  estado                text NOT NULL DEFAULT 'contabilizado' CHECK (estado IN ('contabilizado','revertido')),
  origen_tipo           text NOT NULL CHECK (origen_tipo IN ('gasto_servicio','compra','reversion','pago_proveedor')),
  origen_id             uuid,
  evento_origen         text NOT NULL,
  moneda                text NOT NULL DEFAULT 'PYG',
  tipo_cambio           numeric NOT NULL DEFAULT 1,
  asiento_original_id   uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL,
  asiento_reversion_id  uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asientos_numero_uk UNIQUE (empresa_id, numero_asiento)
);

-- Idempotencia contable: 1 asiento por (empresa, origen, documento, evento).
CREATE UNIQUE INDEX IF NOT EXISTS uq_asientos_origen
  ON neura.asientos_contables (empresa_id, origen_tipo, origen_id, evento_origen)
  WHERE origen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_asientos_fecha  ON neura.asientos_contables (empresa_id, fecha_contable);
CREATE INDEX IF NOT EXISTS ix_asientos_doc    ON neura.asientos_contables (empresa_id, origen_tipo, origen_id);

ALTER TABLE neura.asientos_contables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asientos_select ON neura.asientos_contables;
CREATE POLICY asientos_select ON neura.asientos_contables FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS asientos_insert ON neura.asientos_contables;
CREATE POLICY asientos_insert ON neura.asientos_contables FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS asientos_update ON neura.asientos_contables;
CREATE POLICY asientos_update ON neura.asientos_contables FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS asientos_delete ON neura.asientos_contables;
CREATE POLICY asientos_delete ON neura.asientos_contables FOR DELETE USING (neura.puede_acceder_empresa(empresa_id));
GRANT SELECT ON neura.asientos_contables TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.asientos_contables TO authenticated, service_role;
DROP TRIGGER IF EXISTS tr_asientos_updated ON neura.asientos_contables;
CREATE TRIGGER tr_asientos_updated BEFORE UPDATE ON neura.asientos_contables FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();

-- ── 2) Detalles del asiento ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.asientos_contables_detalles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  asiento_id         uuid NOT NULL REFERENCES neura.asientos_contables(id) ON DELETE CASCADE,
  cuenta_contable_id uuid NOT NULL REFERENCES neura.plan_cuentas(id) ON DELETE RESTRICT,
  proveedor_id       uuid REFERENCES neura.proveedores(id) ON DELETE SET NULL,
  descripcion        text,
  debe               numeric NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber              numeric NOT NULL DEFAULT 0 CHECK (haber >= 0),
  documento_tipo     text,
  documento_id       uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Exactamente un lado positivo (no ambos, no ninguno).
  CONSTRAINT det_debe_xor_haber CHECK ((debe > 0 AND haber = 0) OR (haber > 0 AND debe = 0))
);
CREATE INDEX IF NOT EXISTS ix_asdet_asiento ON neura.asientos_contables_detalles (asiento_id);
CREATE INDEX IF NOT EXISTS ix_asdet_cuenta  ON neura.asientos_contables_detalles (empresa_id, cuenta_contable_id);
CREATE INDEX IF NOT EXISTS ix_asdet_doc     ON neura.asientos_contables_detalles (empresa_id, documento_tipo, documento_id);

ALTER TABLE neura.asientos_contables_detalles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asdet_select ON neura.asientos_contables_detalles;
CREATE POLICY asdet_select ON neura.asientos_contables_detalles FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS asdet_insert ON neura.asientos_contables_detalles;
CREATE POLICY asdet_insert ON neura.asientos_contables_detalles FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS asdet_update ON neura.asientos_contables_detalles;
CREATE POLICY asdet_update ON neura.asientos_contables_detalles FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS asdet_delete ON neura.asientos_contables_detalles;
CREATE POLICY asdet_delete ON neura.asientos_contables_detalles FOR DELETE USING (neura.puede_acceder_empresa(empresa_id));
GRANT SELECT ON neura.asientos_contables_detalles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.asientos_contables_detalles TO authenticated, service_role;

-- ── 3) Configuración contable por empresa ────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.configuracion_contable (
  empresa_id                uuid PRIMARY KEY REFERENCES neura.empresas(id) ON DELETE CASCADE,
  cuenta_iva_credito_5_id   uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  cuenta_iva_credito_10_id  uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  cuenta_proveedores_id     uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  cuenta_caja_id            uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  cuenta_banco_id           uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  updated_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE neura.configuracion_contable ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS confcont_select ON neura.configuracion_contable;
CREATE POLICY confcont_select ON neura.configuracion_contable FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS confcont_insert ON neura.configuracion_contable;
CREATE POLICY confcont_insert ON neura.configuracion_contable FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS confcont_update ON neura.configuracion_contable;
CREATE POLICY confcont_update ON neura.configuracion_contable FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id));
GRANT SELECT ON neura.configuracion_contable TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.configuracion_contable TO authenticated, service_role;
DROP TRIGGER IF EXISTS tr_confcont_updated ON neura.configuracion_contable;
CREATE TRIGGER tr_confcont_updated BEFORE UPDATE ON neura.configuracion_contable FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();

-- ── 4) Períodos contables ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.periodos_contables (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  anio         integer NOT NULL,
  mes          integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  fecha_desde  date NOT NULL,
  fecha_hasta  date NOT NULL,
  estado       text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  cerrado_by   uuid,
  cerrado_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periodos_uk UNIQUE (empresa_id, anio, mes)
);
CREATE INDEX IF NOT EXISTS ix_periodos_rango ON neura.periodos_contables (empresa_id, fecha_desde, fecha_hasta);
ALTER TABLE neura.periodos_contables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS periodos_select ON neura.periodos_contables;
CREATE POLICY periodos_select ON neura.periodos_contables FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS periodos_insert ON neura.periodos_contables;
CREATE POLICY periodos_insert ON neura.periodos_contables FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS periodos_update ON neura.periodos_contables;
CREATE POLICY periodos_update ON neura.periodos_contables FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id));
GRANT SELECT ON neura.periodos_contables TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.periodos_contables TO authenticated, service_role;
DROP TRIGGER IF EXISTS tr_periodos_updated ON neura.periodos_contables;
CREATE TRIGGER tr_periodos_updated BEFORE UPDATE ON neura.periodos_contables FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();

-- ── 5) Correlativo seguro de asientos (AS-000001) ────────────────────────────
CREATE TABLE IF NOT EXISTS neura.asiento_correlativos (
  empresa_id    uuid PRIMARY KEY,
  ultimo_numero bigint NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION neura.next_numero_asiento_empresa(p_empresa_id uuid)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_num bigint;
BEGIN
  IF p_empresa_id IS NULL THEN RAISE EXCEPTION 'next_numero_asiento_empresa: empresa_id es obligatorio'; END IF;
  INSERT INTO neura.asiento_correlativos (empresa_id, ultimo_numero) VALUES (p_empresa_id, 0)
    ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE neura.asiento_correlativos c SET ultimo_numero = c.ultimo_numero + 1, updated_at = now()
    WHERE c.empresa_id = p_empresa_id RETURNING c.ultimo_numero INTO v_num;
  IF v_num IS NULL THEN RAISE EXCEPTION 'No se pudo reservar correlativo de asiento'; END IF;
  RETURN 'AS-' || lpad(v_num::text, 6, '0');
END; $f$;
GRANT EXECUTE ON FUNCTION neura.next_numero_asiento_empresa(uuid) TO service_role, authenticated;

-- ── 6) Columnas de vínculo contable en documentos ───────────────────────────
ALTER TABLE neura.gastos
  ADD COLUMN IF NOT EXISTS estado_contable        text NOT NULL DEFAULT 'no_contabilizado',
  ADD COLUMN IF NOT EXISTS asiento_contable_id    uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cuenta_contrapartida_id uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL;

ALTER TABLE neura.compras
  ADD COLUMN IF NOT EXISTS estado_contable        text NOT NULL DEFAULT 'no_contabilizado',
  ADD COLUMN IF NOT EXISTS asiento_contable_id    uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cuenta_contrapartida_id uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gastos_estado_contable_chk' AND conrelid='neura.gastos'::regclass) THEN
    ALTER TABLE neura.gastos ADD CONSTRAINT gastos_estado_contable_chk CHECK (estado_contable IN ('no_contabilizado','contabilizado','revertido'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='compras_estado_contable_chk' AND conrelid='neura.compras'::regclass) THEN
    ALTER TABLE neura.compras ADD CONSTRAINT compras_estado_contable_chk CHECK (estado_contable IN ('no_contabilizado','contabilizado','revertido'));
  END IF;
END $$;

DO $$
DECLARE v_g int; v_c int;
BEGIN
  SELECT count(*) INTO v_g FROM neura.gastos WHERE estado_contable='no_contabilizado';
  SELECT count(*) INTO v_c FROM neura.compras;
  RAISE NOTICE 'fase2: gastos_no_contabilizados=% compras=% tablas_contables=%',
    v_g, v_c, (SELECT count(*) FROM information_schema.tables WHERE table_schema='neura'
               AND table_name IN ('asientos_contables','asientos_contables_detalles','configuracion_contable','periodos_contables','asiento_correlativos'));
END $$;

COMMIT;
