-- =============================================================================
-- Configuración Contable de VENTAS (espejo de las cuentas de compra).
-- SOLO schema `neura`. Idempotente. Aditiva: columnas nullable FK a plan_cuentas.
-- No borra ni altera datos. Prepara la contabilización de ventas (Fase 2); el
-- Libro de Ventas (Fase 1) es solo-lectura y no depende de estas cuentas.
-- =============================================================================

BEGIN;

ALTER TABLE neura.configuracion_contable
  ADD COLUMN IF NOT EXISTS cuenta_iva_debito_5_id     uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cuenta_iva_debito_10_id    uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cuenta_ventas_gravadas_id  uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cuenta_ventas_exentas_id   uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cuenta_ventas_servicios_id uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cuenta_clientes_id         uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL;

DO $$
DECLARE v_cols int;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='neura' AND table_name='configuracion_contable'
     AND column_name IN ('cuenta_iva_debito_5_id','cuenta_iva_debito_10_id','cuenta_ventas_gravadas_id',
                         'cuenta_ventas_exentas_id','cuenta_ventas_servicios_id','cuenta_clientes_id');
  RAISE NOTICE 'config ventas: columnas_nuevas=%', v_cols;
END $$;

COMMIT;
