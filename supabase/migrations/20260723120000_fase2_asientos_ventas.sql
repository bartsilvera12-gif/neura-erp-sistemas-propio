-- =============================================================================
-- FASE 2 — Asientos contables de VENTAS. SOLO schema `neura`. Idempotente.
-- Amplía origen_tipo del motor con 'factura_venta' y 'nota_credito_venta', y
-- agrega estado_contable / asiento_contable_id / contab_error a facturas y
-- nota_credito. No borra ni altera datos existentes.
-- =============================================================================

BEGIN;

-- 1) Ampliar el CHECK de origen_tipo (superconjunto → no invalida asientos previos).
ALTER TABLE neura.asientos_contables DROP CONSTRAINT IF EXISTS asientos_contables_origen_tipo_check;
ALTER TABLE neura.asientos_contables
  ADD CONSTRAINT asientos_contables_origen_tipo_check
  CHECK (origen_tipo IN ('gasto_servicio','compra','reversion','pago_proveedor','factura_venta','nota_credito_venta'));

-- 2) Columnas de contabilización en facturas.
ALTER TABLE neura.facturas
  ADD COLUMN IF NOT EXISTS estado_contable     text NOT NULL DEFAULT 'no_contabilizado',
  ADD COLUMN IF NOT EXISTS asiento_contable_id uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contab_error        text;

DO $$ BEGIN
  ALTER TABLE neura.facturas ADD CONSTRAINT facturas_estado_contable_chk
    CHECK (estado_contable IN ('no_contabilizado','contabilizado','error','revertido'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Columnas de contabilización en nota_credito.
ALTER TABLE neura.nota_credito
  ADD COLUMN IF NOT EXISTS estado_contable     text NOT NULL DEFAULT 'no_contabilizado',
  ADD COLUMN IF NOT EXISTS asiento_contable_id uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contab_error        text;

DO $$ BEGIN
  ALTER TABLE neura.nota_credito ADD CONSTRAINT nota_credito_estado_contable_chk
    CHECK (estado_contable IN ('no_contabilizado','contabilizado','error','revertido'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Índices de apoyo para el sweep/backfill (pendientes de contabilizar).
CREATE INDEX IF NOT EXISTS ix_facturas_estado_contable ON neura.facturas (empresa_id, estado_contable);
CREATE INDEX IF NOT EXISTS ix_nc_estado_contable ON neura.nota_credito (empresa_id, estado_contable);

DO $$
DECLARE v_f int; v_n int;
BEGIN
  SELECT count(*) INTO v_f FROM information_schema.columns
   WHERE table_schema='neura' AND table_name='facturas' AND column_name IN ('estado_contable','asiento_contable_id','contab_error');
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='neura' AND table_name='nota_credito' AND column_name IN ('estado_contable','asiento_contable_id','contab_error');
  RAISE NOTICE 'fase2 ventas: facturas_cols=% nc_cols=%', v_f, v_n;
END $$;

COMMIT;
