-- Caja del 2.0 en Neura: puntos de venta, turnos (apertura → ventas/retiros → arqueo → cierre)
-- y movimientos de caja. Todo ADITIVO:
--   · tablas nuevas: caja_puntos, caja_turnos, caja_movimientos
--   · columnas nuevas (nullable) en neura.ventas / neura.ventas_items, que hoy están vacías
--   · movimientos_inventario acepta además el origen 'anulacion_venta'
-- No toca facturas, factura_items, pagos ni clientes: la venta "con factura" crea una factura
-- normal de Neura por el mismo camino de siempre (SIFEN, libro de ventas, cobranzas).

BEGIN;

CREATE TABLE IF NOT EXISTS neura.caja_puntos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  ubicacion_id uuid NOT NULL REFERENCES neura.inventario_ubicaciones(id),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS caja_puntos_nombre_uq ON neura.caja_puntos (empresa_id, lower(nombre));

CREATE TABLE IF NOT EXISTS neura.caja_turnos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  punto_venta_id uuid NOT NULL REFERENCES neura.caja_puntos(id),
  numero_caja integer NOT NULL,
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  abierta_por uuid,
  abierta_por_nombre text,
  cerrada_por uuid,
  cerrada_por_nombre text,
  fecha_apertura timestamptz NOT NULL DEFAULT now(),
  fecha_cierre timestamptz,
  monto_apertura numeric NOT NULL DEFAULT 0 CHECK (monto_apertura >= 0),
  observacion_apertura text,
  monto_cierre_contado numeric,
  monto_esperado_efectivo numeric,
  diferencia numeric,
  diferencia_otros numeric,
  declarado jsonb,
  billetes jsonb,
  motivo_diferencia text,
  observacion_cierre text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Un solo turno abierto por caja.
CREATE UNIQUE INDEX IF NOT EXISTS caja_turnos_uno_abierto ON neura.caja_turnos (punto_venta_id) WHERE estado = 'abierta';
CREATE UNIQUE INDEX IF NOT EXISTS caja_turnos_numero_uq ON neura.caja_turnos (empresa_id, numero_caja);
CREATE INDEX IF NOT EXISTS caja_turnos_empresa_idx ON neura.caja_turnos (empresa_id, fecha_apertura DESC);

CREATE TABLE IF NOT EXISTS neura.caja_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  turno_id uuid NOT NULL REFERENCES neura.caja_turnos(id),
  tipo text NOT NULL CHECK (tipo IN ('ingreso', 'egreso', 'retiro', 'ajuste')),
  origen text NOT NULL CHECK (origen IN ('venta', 'cobro', 'compra', 'gasto', 'pago_proveedor', 'devolucion', 'manual')),
  numero text,
  concepto text NOT NULL,
  motivo text,
  monto numeric NOT NULL CHECK (monto > 0),
  medio_pago text NOT NULL DEFAULT 'efectivo'
    CHECK (medio_pago IN ('efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia', 'qr', 'cheque', 'otro')),
  recibido numeric,
  vuelto numeric,
  referencia text,
  banco text,
  observacion text,
  venta_id uuid REFERENCES neura.ventas(id),
  factura_id uuid REFERENCES neura.facturas(id),
  pago_id uuid REFERENCES neura.pagos(id) ON DELETE SET NULL,
  usuario_id uuid,
  usuario_nombre text,
  anulado_at timestamptz,
  anulado_por uuid,
  anulado_motivo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caja_mov_turno_idx ON neura.caja_movimientos (turno_id);
CREATE INDEX IF NOT EXISTS caja_mov_venta_idx ON neura.caja_movimientos (venta_id);

-- Ventas del POS (tabla existente, sin filas hasta hoy): columnas nuevas, todas opcionales.
ALTER TABLE neura.ventas
  ADD COLUMN IF NOT EXISTS caja_turno_id uuid REFERENCES neura.caja_turnos(id),
  ADD COLUMN IF NOT EXISTS factura_id uuid REFERENCES neura.facturas(id),
  ADD COLUMN IF NOT EXISTS tipo_documento text,
  ADD COLUMN IF NOT EXISTS metodo_pago text,
  ADD COLUMN IF NOT EXISTS descuento_pct numeric,
  ADD COLUMN IF NOT EXISTS anulada_at timestamptz,
  ADD COLUMN IF NOT EXISTS anulada_por uuid,
  ADD COLUMN IF NOT EXISTS anulada_motivo text;
CREATE UNIQUE INDEX IF NOT EXISTS ventas_numero_control_uq ON neura.ventas (empresa_id, numero_control);
CREATE UNIQUE INDEX IF NOT EXISTS ventas_idempotency_uq ON neura.ventas (empresa_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ventas_turno_idx ON neura.ventas (caja_turno_id);
CREATE INDEX IF NOT EXISTS ventas_factura_idx ON neura.ventas (factura_id);

ALTER TABLE neura.ventas_items
  ADD COLUMN IF NOT EXISTS costo_unitario numeric,
  ADD COLUMN IF NOT EXISTS tipo_precio text;

-- Stock: la anulación de una venta devuelve la mercadería con su propio origen.
ALTER TABLE neura.movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check;
ALTER TABLE neura.movimientos_inventario ADD CONSTRAINT movimientos_inventario_origen_check CHECK (origen = ANY (ARRAY[
  'compra', 'venta', 'ajuste_manual', 'inventario_inicial', 'recepcion', 'ajuste', 'perdida',
  'anulacion_ajuste', 'traslado_salida', 'traslado_entrada', 'anulacion_traslado', 'anulacion_venta']));

-- Igual que pagos_proveedores: solo el servidor (conexión directa) las usa; RLS cerrado al público.
ALTER TABLE neura.caja_puntos ENABLE ROW LEVEL SECURITY;
ALTER TABLE neura.caja_turnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE neura.caja_movimientos ENABLE ROW LEVEL SECURITY;

COMMIT;
