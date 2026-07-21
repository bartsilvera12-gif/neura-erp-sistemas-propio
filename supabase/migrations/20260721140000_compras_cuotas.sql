-- =============================================================================
-- Compras a crédito: cantidad de cuotas. SOLO schema `neura`. Idempotente.
-- Nullable-safe: default 1 (una cuota) → compras históricas quedan en 1 cuota.
-- No borra ni altera datos existentes.
-- =============================================================================

BEGIN;

ALTER TABLE neura.compras
  ADD COLUMN IF NOT EXISTS cuotas integer NOT NULL DEFAULT 1 CHECK (cuotas >= 1);

DO $$
DECLARE v_ok int;
BEGIN
  SELECT count(*) INTO v_ok FROM information_schema.columns
   WHERE table_schema='neura' AND table_name='compras' AND column_name='cuotas';
  RAISE NOTICE 'compras.cuotas creada=%', v_ok;
END $$;

COMMIT;
