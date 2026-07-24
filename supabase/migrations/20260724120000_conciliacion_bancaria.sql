-- =============================================================================
-- CONCILIACIÓN BANCARIA — transferencias pendientes de aprobación.
-- SOLO schema `neura`. Idempotente. No borra ni altera datos existentes.
--
-- Una transferencia entra como `pendiente` (no reduce saldo, no genera asiento).
-- Al APROBARLA nace el `pago` (reduce saldo) + asiento de cobro. Solo transferencias.
-- =============================================================================

BEGIN;

-- 1) Tabla de transferencias pendientes de conciliación.
CREATE TABLE IF NOT EXISTS neura.cobros_pendientes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  factura_id            uuid NOT NULL REFERENCES neura.facturas(id) ON DELETE RESTRICT,
  cliente_id            uuid REFERENCES neura.clientes(id) ON DELETE SET NULL,
  monto                 numeric NOT NULL CHECK (monto > 0),
  fecha                 date NOT NULL DEFAULT current_date,
  metodo                text NOT NULL DEFAULT 'transferencia' CHECK (metodo = 'transferencia'),
  banco_origen          text NOT NULL,
  banco_origen_norm     text NOT NULL,
  titular               text NOT NULL,
  numero_operacion      text NOT NULL,
  numero_operacion_norm text NOT NULL,
  comprobante_path      text,
  comprobante_mime      text,
  estado                text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  motivo_rechazo        text,
  pago_id               uuid REFERENCES neura.pagos(id) ON DELETE SET NULL,
  idempotency_key       uuid,
  created_by            uuid,
  aprobado_by           uuid,
  aprobado_at           timestamptz,
  rechazado_by          uuid,
  rechazado_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Anti-duplicados (sobre valores NORMALIZADOS), excluyendo rechazadas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cobros_pend_banco_op
  ON neura.cobros_pendientes (empresa_id, banco_origen_norm, numero_operacion_norm)
  WHERE estado <> 'rechazado';
CREATE UNIQUE INDEX IF NOT EXISTS uq_cobros_pend_idem
  ON neura.cobros_pendientes (empresa_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cobros_pend_estado ON neura.cobros_pendientes (empresa_id, estado, fecha DESC);
CREATE INDEX IF NOT EXISTS ix_cobros_pend_factura ON neura.cobros_pendientes (empresa_id, factura_id);

-- 2) Contabilización de pagos + marca de anticipo.
ALTER TABLE neura.pagos
  ADD COLUMN IF NOT EXISTS estado_contable     text NOT NULL DEFAULT 'no_contabilizado',
  ADD COLUMN IF NOT EXISTS asiento_contable_id uuid REFERENCES neura.asientos_contables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contab_error        text,
  ADD COLUMN IF NOT EXISTS es_anticipo         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cobro_pendiente_id  uuid REFERENCES neura.cobros_pendientes(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE neura.pagos ADD CONSTRAINT pagos_estado_contable_chk
    CHECK (estado_contable IN ('no_contabilizado','contabilizado','error','revertido'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_pagos_estado_contable ON neura.pagos (empresa_id, estado_contable);
CREATE INDEX IF NOT EXISTS ix_pagos_anticipo ON neura.pagos (empresa_id, es_anticipo) WHERE es_anticipo = true;

-- 3) Ampliar CHECK de origen_tipo (superconjunto).
ALTER TABLE neura.asientos_contables DROP CONSTRAINT IF EXISTS asientos_contables_origen_tipo_check;
ALTER TABLE neura.asientos_contables
  ADD CONSTRAINT asientos_contables_origen_tipo_check
  CHECK (origen_tipo IN ('gasto_servicio','compra','reversion','pago_proveedor',
                         'factura_venta','nota_credito_venta','cobro_cliente','reclasificacion_anticipo'));

-- 4) Cuenta de Anticipos de Clientes en la configuración contable.
ALTER TABLE neura.configuracion_contable
  ADD COLUMN IF NOT EXISTS cuenta_anticipos_clientes_id uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL;

-- 5) RLS + grants + trigger para cobros_pendientes.
ALTER TABLE neura.cobros_pendientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobrospend_sel ON neura.cobros_pendientes;
CREATE POLICY cobrospend_sel ON neura.cobros_pendientes FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS cobrospend_ins ON neura.cobros_pendientes;
CREATE POLICY cobrospend_ins ON neura.cobros_pendientes FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS cobrospend_upd ON neura.cobros_pendientes;
CREATE POLICY cobrospend_upd ON neura.cobros_pendientes FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS cobrospend_del ON neura.cobros_pendientes;
CREATE POLICY cobrospend_del ON neura.cobros_pendientes FOR DELETE USING (neura.puede_acceder_empresa(empresa_id));
GRANT SELECT ON neura.cobros_pendientes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.cobros_pendientes TO authenticated, service_role;
DROP TRIGGER IF EXISTS tr_cobrospend_updated ON neura.cobros_pendientes;
CREATE TRIGGER tr_cobrospend_updated BEFORE UPDATE ON neura.cobros_pendientes FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();

DO $$
DECLARE v_t int; v_p int; v_cfg int;
BEGIN
  SELECT count(*) INTO v_t FROM information_schema.tables WHERE table_schema='neura' AND table_name='cobros_pendientes';
  SELECT count(*) INTO v_p FROM information_schema.columns WHERE table_schema='neura' AND table_name='pagos'
    AND column_name IN ('estado_contable','asiento_contable_id','contab_error','es_anticipo','cobro_pendiente_id');
  SELECT count(*) INTO v_cfg FROM information_schema.columns WHERE table_schema='neura' AND table_name='configuracion_contable'
    AND column_name='cuenta_anticipos_clientes_id';
  RAISE NOTICE 'conciliacion: tabla=% pagos_cols=% cfg_anticipos=%', v_t, v_p, v_cfg;
END $$;

COMMIT;
