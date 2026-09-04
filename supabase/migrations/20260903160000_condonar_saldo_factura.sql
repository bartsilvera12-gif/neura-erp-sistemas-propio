-- Condonación / incobrable del SALDO restante de una factura parcialmente pagada.
-- Agrega la cuenta contable destino (Descuentos Concedidos 51115) a la config contable y
-- columnas de auditoría de condonación en facturas. No borra ni toca pagos existentes.

SET search_path = neura, public;

-- 1) Cuenta destino del write-off en la config contable (default: 51115 Descuentos Concedidos).
ALTER TABLE neura.configuracion_contable
  ADD COLUMN IF NOT EXISTS cuenta_descuentos_incobrables_id uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL;

UPDATE neura.configuracion_contable cc
   SET cuenta_descuentos_incobrables_id = pc.id
  FROM neura.plan_cuentas pc
 WHERE pc.empresa_id = cc.empresa_id
   AND pc.cuenta = '51115'
   AND cc.cuenta_descuentos_incobrables_id IS NULL;

-- 2) Auditoría de la condonación en facturas.
ALTER TABLE neura.facturas
  ADD COLUMN IF NOT EXISTS condonacion_tipo       text,      -- 'condonado' | 'incobrable'
  ADD COLUMN IF NOT EXISTS condonado_by           uuid,
  ADD COLUMN IF NOT EXISTS condonado_at           timestamptz,
  ADD COLUMN IF NOT EXISTS condonacion_motivo     text,
  ADD COLUMN IF NOT EXISTS condonacion_asiento_id uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL;

-- 3) Nuevo origen_tipo para el asiento de condonación.
ALTER TABLE neura.asientos_contables DROP CONSTRAINT IF EXISTS asientos_contables_origen_tipo_check;
ALTER TABLE neura.asientos_contables ADD CONSTRAINT asientos_contables_origen_tipo_check
  CHECK (origen_tipo IN ('gasto_servicio','compra','reversion','pago_proveedor','factura_venta','nota_credito_venta','cobro_cliente','reclasificacion_anticipo','condonacion'));
