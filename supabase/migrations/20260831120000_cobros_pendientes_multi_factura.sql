-- ============================================================================
-- Cobro múltiple: una transferencia puede cubrir VARIAS facturas.
--
-- El anti-duplicado era por (empresa, banco_origen_norm, numero_operacion_norm),
-- lo que impedía usar el mismo N° de operación para más de una factura. Se amplía
-- con `factura_id`: una misma transferencia puede aplicarse a facturas DISTINTAS,
-- pero sigue bloqueando cargar dos veces la misma (transfer, factura).
-- ============================================================================

DROP INDEX IF EXISTS neura.uq_cobros_pend_banco_op;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cobros_pend_banco_op_fac
  ON neura.cobros_pendientes (empresa_id, banco_origen_norm, numero_operacion_norm, factura_id)
  WHERE estado <> 'rechazado';
