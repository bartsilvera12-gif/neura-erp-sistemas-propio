-- =============================================================================
-- SOLICITUDES DE COMPRA — capa de flujo por roles sobre `ordenes_compra`
--
-- Comercial crea una SOLICITUD (estado 'solicitada'), Alan la confirma
-- (-> 'aprobada') o la rechaza (-> 'rechazada'), y Guillermo confirma el PAGO
-- (pago_estado 'confirmado'). La recepción (ya existente) ingresa el stock.
--
-- No crea tablas nuevas: extiende `neura.ordenes_compra` reutilizando sus items,
-- proveedor, totales y aprobación. El pago es una columna aparte porque es
-- ortogonal a la recepción.
--
-- SOLO schema `neura`. Idempotente. No toca compras/movimientos históricos.
-- Aplicar: node scripts/apply-migration-file-pg.cjs <este archivo>  (o SSH psql).
--   * Ampliar el CHECK de estado puede requerir SET ROLE supabase_admin al
--     aplicar (postgres es miembro). Si "da OK" pero el estado nuevo no entra,
--     reaplicar con el rol correcto.
-- =============================================================================

BEGIN;

-- Las tablas de `neura` las posee supabase_admin: sin este rol, los ALTER sobre
-- `ordenes_compra` fallan (o el CHECK "da OK" pero no entra). postgres es miembro.
SET ROLE supabase_admin;

-- ── 1) Nuevos estados: 'solicitada' (pedido de comercial) y 'rechazada' ───────
-- El CHECK original es inline (autonombrado ordenes_compra_estado_check).
ALTER TABLE neura.ordenes_compra DROP CONSTRAINT IF EXISTS ordenes_compra_estado_check;
ALTER TABLE neura.ordenes_compra
  ADD CONSTRAINT ordenes_compra_estado_check
  CHECK (estado IN (
    'solicitada',            -- creada por comercial (nuevo primer estado)
    'borrador',
    'aprobada',
    'parcialmente_recibida',
    'recibida',
    'cerrada',
    'cancelada',
    'rechazada'              -- solicitud rechazada por quien confirma (nuevo)
  ));

-- ── 2) Quién/cuándo solicitó (comercial) ─────────────────────────────────────
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS solicitada_by   uuid;
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS solicitada_at   timestamptz;

-- ── 3) Gate de pago (Guillermo), ortogonal a la recepción ────────────────────
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS pago_estado     text NOT NULL DEFAULT 'pendiente';
ALTER TABLE neura.ordenes_compra DROP CONSTRAINT IF EXISTS ordenes_compra_pago_estado_check;
ALTER TABLE neura.ordenes_compra
  ADD CONSTRAINT ordenes_compra_pago_estado_check
  CHECK (pago_estado IN ('pendiente','confirmado'));
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS pago_confirmado_by uuid;
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS pago_confirmado_at timestamptz;
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS pago_metodo        text;
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS pago_referencia    text;

-- ── 4) Rechazo de una solicitud (Alan) ───────────────────────────────────────
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS rechazada_by    uuid;
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS rechazada_at    timestamptz;
ALTER TABLE neura.ordenes_compra ADD COLUMN IF NOT EXISTS motivo_rechazo  text;

-- ── 5) Índices para las bandejas por rol ─────────────────────────────────────
-- "Por confirmar": estado = 'solicitada'  (ya cubierto por ix_ordenes_compra_estado).
-- "Por pagar": aprobadas con pago pendiente.
CREATE INDEX IF NOT EXISTS ix_ordenes_compra_por_pagar
  ON neura.ordenes_compra (empresa_id, fecha DESC)
  WHERE estado = 'aprobada' AND pago_estado = 'pendiente';

-- ── 6) PostgREST tiene que ver las columnas nuevas ───────────────────────────
-- Sin esto la API responde 400 "could not find column in schema cache".
SELECT pg_notify('pgrst', 'reload schema');

RESET ROLE;

COMMIT;
