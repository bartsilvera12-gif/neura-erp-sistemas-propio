-- =============================================================================
-- Gastos y Servicios — clave de idempotencia para el flujo directo Confirmar.
-- SOLO schema `neura`. Idempotente. No borra datos.
-- Evita que un doble-clic al "Confirmar gasto o servicio" cree dos documentos
-- o consuma dos correlativos. Índice único parcial → históricos/existentes intactos.
-- =============================================================================

BEGIN;

ALTER TABLE neura.gastos
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gastos_idempotency_key
  ON neura.gastos (empresa_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='neura' AND table_name='gastos' AND column_name='idempotency_key';
  RAISE NOTICE 'gastos.idempotency_key presente=%', v;
END $$;

COMMIT;
