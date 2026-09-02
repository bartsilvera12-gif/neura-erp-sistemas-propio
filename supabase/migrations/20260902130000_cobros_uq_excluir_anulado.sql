-- El índice anti-duplicados (empresa, banco, op, factura) excluía solo 'rechazado'.
-- Una transferencia ANULADA seguía dentro del índice y bloqueaba volver a cargar la correcta.
-- Se recrea excluyendo también 'anulado'.

SET search_path = neura, public;

DROP INDEX IF EXISTS neura.uq_cobros_pend_banco_op_fac;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cobros_pend_banco_op_fac
  ON neura.cobros_pendientes (empresa_id, banco_origen_norm, numero_operacion_norm, factura_id)
  WHERE estado NOT IN ('rechazado','anulado');
