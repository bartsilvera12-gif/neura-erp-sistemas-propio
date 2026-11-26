-- =============================================================================
-- Pagos a proveedores (pantalla Compras › Pagos traída del ERP 2.0).
--
-- Solo agrega tablas nuevas: no cambia ninguna existente. Un pago tiene sus medios
-- (efectivo, transferencia, cheque…) y se aplica a una o varias compras a crédito.
-- Lo que se debe de una compra = su total − lo aplicado de pagos no anulados.
-- El asiento contable (Proveedores al debe, Caja/Banco al haber) lo genera la app con el
-- motor contable de siempre (origen 'pago_proveedor', que ya existe).
-- Solo schema `neura`. No toca facturas, pagos de clientes, compras ni asientos existentes.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS neura.pagos_proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  numero text NOT NULL,
  proveedor_id uuid NOT NULL REFERENCES neura.proveedores(id),
  fecha date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Asuncion')::date),
  moneda text NOT NULL DEFAULT 'PYG',
  total numeric NOT NULL CHECK (total > 0),
  observacion text,
  estado text NOT NULL DEFAULT 'aplicado' CHECK (estado IN ('aplicado', 'anulado')),
  asiento_contable_id uuid,
  asiento_anulacion_id uuid,
  idempotency_key uuid,
  created_by uuid,
  usuario_nombre text,
  created_at timestamptz NOT NULL DEFAULT now(),
  anulado_por uuid,
  anulado_por_nombre text,
  anulado_at timestamptz,
  anulado_motivo text,
  UNIQUE (empresa_id, numero)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_proveedores_idem
  ON neura.pagos_proveedores (empresa_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_proveedor ON neura.pagos_proveedores (empresa_id, proveedor_id, fecha DESC);

CREATE TABLE IF NOT EXISTS neura.pagos_proveedores_medios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  pago_id uuid NOT NULL REFERENCES neura.pagos_proveedores(id) ON DELETE CASCADE,
  metodo text NOT NULL CHECK (metodo IN ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro')),
  monto numeric NOT NULL CHECK (monto > 0),
  referencia text
);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_medios_pago ON neura.pagos_proveedores_medios (pago_id);

CREATE TABLE IF NOT EXISTS neura.pagos_proveedores_aplicaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  pago_id uuid NOT NULL REFERENCES neura.pagos_proveedores(id) ON DELETE CASCADE,
  compra_id uuid NOT NULL REFERENCES neura.compras(id),
  monto numeric NOT NULL CHECK (monto > 0)
);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_aplic_pago ON neura.pagos_proveedores_aplicaciones (pago_id);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_aplic_compra ON neura.pagos_proveedores_aplicaciones (compra_id);

ALTER TABLE neura.pagos_proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE neura.pagos_proveedores_medios ENABLE ROW LEVEL SECURITY;
ALTER TABLE neura.pagos_proveedores_aplicaciones ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
