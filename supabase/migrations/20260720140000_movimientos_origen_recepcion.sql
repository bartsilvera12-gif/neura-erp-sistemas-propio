-- =============================================================================
-- Habilita 'recepcion' como origen válido de movimientos_inventario.
-- La recepción de mercadería es el movimiento FÍSICO del circuito
-- Orden → Recepción → Compra, y debe distinguirse de 'compra' (fiscal).
-- SOLO schema `neura`. Idempotente. No altera datos existentes: el nuevo CHECK
-- es un superconjunto del anterior, por lo que ninguna fila histórica se invalida.
-- =============================================================================

BEGIN;

ALTER TABLE neura.movimientos_inventario
  DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check;

ALTER TABLE neura.movimientos_inventario
  ADD CONSTRAINT movimientos_inventario_origen_check
  CHECK (origen = ANY (ARRAY['compra','venta','ajuste_manual','inventario_inicial','recepcion']));

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'neura.movimientos_inventario'::regclass
     AND conname = 'movimientos_inventario_origen_check';
  RAISE NOTICE 'origen_check = %', v_def;
END $$;

COMMIT;
