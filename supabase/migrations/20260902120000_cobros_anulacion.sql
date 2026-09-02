-- Anulación de transferencias APROBADAS (reversión contable, opción A).
-- Agrega el estado 'anulado' a cobros_pendientes + auditoría de anulación, y ajusta el índice
-- anti-duplicados para que un cobro anulado NO bloquee re-registrar el mismo banco+operación.

SET search_path = neura, public;

-- 1) Permitir estado 'anulado' (el CHECK inline se auto-nombró cobros_pendientes_estado_check).
ALTER TABLE neura.cobros_pendientes DROP CONSTRAINT IF EXISTS cobros_pendientes_estado_check;
ALTER TABLE neura.cobros_pendientes
  ADD CONSTRAINT cobros_pendientes_estado_check
  CHECK (estado IN ('pendiente','aprobado','rechazado','anulado'));

-- 2) Auditoría de la anulación.
ALTER TABLE neura.cobros_pendientes
  ADD COLUMN IF NOT EXISTS anulado_by           uuid,
  ADD COLUMN IF NOT EXISTS anulado_at           timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_anulacion     text,
  ADD COLUMN IF NOT EXISTS asiento_reversion_id uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL;

-- 3) Índice anti-duplicados: se deja fuera de esta migración. El índice único
-- uq_cobros_pend_banco_op NO existe en la instancia (había duplicados históricos), así que
-- recrearlo excluyendo 'anulado' fallaría. Si se quiere reactivar, primero limpiar duplicados.
-- Al no haber índice, un cobro anulado tampoco bloquea re-registrar la transferencia correcta.
