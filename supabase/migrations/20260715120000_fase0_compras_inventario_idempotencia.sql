-- =============================================================================
-- FASE 0 — Saneamiento de Compras ↔ Inventario. SOLO schema `neura`. Idempotente.
-- 1) movimientos_inventario: vínculo fuerte al documento origen (documento_tipo, documento_id).
-- 2) compras: afecta_stock (scaffolding recepción) + idempotency_key (anti doble-envío).
-- 3) Índices únicos parciales: 1 movimiento por (empresa,documento,producto) y
--    1 compra por (empresa,idempotency_key). Ambos parciales → NO afectan históricos NULL.
-- No borra ni modifica datos. No toca otros schemas. No edita migraciones aplicadas.
-- =============================================================================

BEGIN;

-- 1) Vínculo fuerte movimiento → documento origen. Nullable: los movimientos
--    históricos y de otros orígenes (venta/ajuste/inicial) quedan con NULL.
ALTER TABLE neura.movimientos_inventario
  ADD COLUMN IF NOT EXISTS documento_tipo text,
  ADD COLUMN IF NOT EXISTS documento_id   uuid;

-- 2) Compras: afecta_stock (todas las directas actuales = true por default) y
--    clave de idempotencia (nullable → históricos sin restricción).
ALTER TABLE neura.compras
  ADD COLUMN IF NOT EXISTS afecta_stock    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

-- 3a) Idempotencia de inventario: 1 solo movimiento por documento+producto.
--     Parcial (WHERE documento_id IS NOT NULL) → históricos y ajustes manuales intactos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_movimientos_documento
  ON neura.movimientos_inventario (empresa_id, documento_tipo, documento_id, producto_id)
  WHERE documento_id IS NOT NULL;

-- Índice de apoyo para búsquedas por documento (no único).
CREATE INDEX IF NOT EXISTS ix_movimientos_documento
  ON neura.movimientos_inventario (empresa_id, documento_tipo, documento_id);

-- 3b) Idempotencia de compra: un doble-envío con la misma clave no crea 2 compras.
--     Parcial (WHERE idempotency_key IS NOT NULL) → compras históricas sin clave intactas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_idempotency_key
  ON neura.compras (empresa_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
DECLARE
  v_mov_cols int;
  v_com_cols int;
BEGIN
  SELECT count(*) INTO v_mov_cols FROM information_schema.columns
    WHERE table_schema='neura' AND table_name='movimientos_inventario'
      AND column_name IN ('documento_tipo','documento_id');
  SELECT count(*) INTO v_com_cols FROM information_schema.columns
    WHERE table_schema='neura' AND table_name='compras'
      AND column_name IN ('afecta_stock','idempotency_key');
  RAISE NOTICE 'fase0: movimientos_nuevas_cols=% compras_nuevas_cols=%', v_mov_cols, v_com_cols;
END $$;

COMMIT;
