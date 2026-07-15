-- =============================================================================
-- FASE 1 — Gastos y Servicios. SOLO schema `neura`. Idempotente. No borra datos.
-- 1) Amplía neura.gastos con cabecera fiscal + estados (borrador/confirmado/anulado/historico).
-- 2) Crea neura.gasto_items (líneas con cuenta contable propia).
-- 3) Correlativo seguro GS-000001 (tabla contador + función atómica, patrón facturas).
-- 4) Registra el módulo/permiso `contabilidad` en neura.modulos.
-- Preserva los 14 gastos históricos → estado='historico' (sin inventar datos fiscales).
-- No toca inventario, ventas, SIFEN, pagos, plan de cuentas ni otros schemas.
-- =============================================================================

BEGIN;

-- ── 1) Cabecera de Gastos y Servicios ────────────────────────────────────────
ALTER TABLE neura.gastos
  ADD COLUMN IF NOT EXISTS proveedor_id       uuid REFERENCES neura.proveedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS numero             text,
  ADD COLUMN IF NOT EXISTS tipo_comprobante   text,
  ADD COLUMN IF NOT EXISTS numero_comprobante text,
  ADD COLUMN IF NOT EXISTS timbrado           text,
  ADD COLUMN IF NOT EXISTS fecha_comprobante  date,
  ADD COLUMN IF NOT EXISTS fecha_contable     date,
  ADD COLUMN IF NOT EXISTS tipo_pago          text,
  ADD COLUMN IF NOT EXISTS plazo_dias         integer,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento  date,
  ADD COLUMN IF NOT EXISTS moneda             text,
  ADD COLUMN IF NOT EXISTS tipo_cambio        numeric,
  ADD COLUMN IF NOT EXISTS subtotal           numeric,
  ADD COLUMN IF NOT EXISTS monto_iva          numeric,
  ADD COLUMN IF NOT EXISTS total              numeric,
  ADD COLUMN IF NOT EXISTS estado             text,
  ADD COLUMN IF NOT EXISTS confirmado_at      timestamptz,
  ADD COLUMN IF NOT EXISTS confirmado_by      uuid,
  ADD COLUMN IF NOT EXISTS anulado_at         timestamptz,
  ADD COLUMN IF NOT EXISTS anulado_by         uuid,
  ADD COLUMN IF NOT EXISTS motivo_anulacion   text,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

-- Preservar históricos: los registros existentes (sin estado) → 'historico'.
UPDATE neura.gastos SET estado = 'historico' WHERE estado IS NULL;

-- Nuevos registros nacen como borrador.
ALTER TABLE neura.gastos ALTER COLUMN estado SET DEFAULT 'borrador';
ALTER TABLE neura.gastos ALTER COLUMN estado SET NOT NULL;

-- Constraints de estado y condición de pago (idempotentes).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gastos_estado_chk' AND conrelid='neura.gastos'::regclass) THEN
    ALTER TABLE neura.gastos ADD CONSTRAINT gastos_estado_chk
      CHECK (estado IN ('borrador','confirmado','anulado','historico'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='gastos_tipo_pago_chk' AND conrelid='neura.gastos'::regclass) THEN
    ALTER TABLE neura.gastos ADD CONSTRAINT gastos_tipo_pago_chk
      CHECK (tipo_pago IS NULL OR tipo_pago IN ('contado','credito'));
  END IF;
END $$;

-- Numeración única por empresa (solo cuando hay número asignado).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gastos_numero
  ON neura.gastos (empresa_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_gastos_estado       ON neura.gastos (empresa_id, estado);
CREATE INDEX IF NOT EXISTS ix_gastos_fecha_compr  ON neura.gastos (empresa_id, fecha_comprobante);
CREATE INDEX IF NOT EXISTS ix_gastos_proveedor    ON neura.gastos (empresa_id, proveedor_id);

DROP TRIGGER IF EXISTS tr_gastos_updated ON neura.gastos;
CREATE TRIGGER tr_gastos_updated BEFORE UPDATE ON neura.gastos
  FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();

-- ── 2) Líneas del documento ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.gasto_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  gasto_id           uuid NOT NULL REFERENCES neura.gastos(id) ON DELETE CASCADE,
  descripcion        text NOT NULL,
  cuenta_contable_id uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  subtotal           numeric NOT NULL DEFAULT 0,
  iva_tipo           text NOT NULL DEFAULT 'exenta' CHECK (iva_tipo IN ('exenta','5','10')),
  monto_iva          numeric NOT NULL DEFAULT 0,
  total_linea        numeric NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gasto_items_gasto   ON neura.gasto_items (gasto_id);
CREATE INDEX IF NOT EXISTS ix_gasto_items_empresa ON neura.gasto_items (empresa_id);

ALTER TABLE neura.gasto_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gasto_items_select ON neura.gasto_items;
CREATE POLICY gasto_items_select ON neura.gasto_items
  FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS gasto_items_insert ON neura.gasto_items;
CREATE POLICY gasto_items_insert ON neura.gasto_items
  FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS gasto_items_update ON neura.gasto_items;
CREATE POLICY gasto_items_update ON neura.gasto_items
  FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id))
  WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS gasto_items_delete ON neura.gasto_items;
CREATE POLICY gasto_items_delete ON neura.gasto_items
  FOR DELETE USING (neura.puede_acceder_empresa(empresa_id));

GRANT SELECT ON neura.gasto_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.gasto_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.gasto_items TO service_role;

DROP TRIGGER IF EXISTS tr_gasto_items_updated ON neura.gasto_items;
CREATE TRIGGER tr_gasto_items_updated BEFORE UPDATE ON neura.gasto_items
  FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();

-- ── 3) Correlativo seguro GS-000001 (patrón facturas: contador + función atómica) ─
CREATE TABLE IF NOT EXISTS neura.gasto_correlativos (
  empresa_id    uuid PRIMARY KEY,
  prefijo       text NOT NULL DEFAULT 'GS-',
  ultimo_numero bigint NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION neura.next_numero_gasto_empresa(p_empresa_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $f$
DECLARE
  v_num bigint;
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'next_numero_gasto_empresa: empresa_id es obligatorio';
  END IF;
  INSERT INTO neura.gasto_correlativos (empresa_id, ultimo_numero)
  VALUES (p_empresa_id, 0)
  ON CONFLICT (empresa_id) DO NOTHING;

  UPDATE neura.gasto_correlativos c
     SET ultimo_numero = c.ultimo_numero + 1, updated_at = now()
   WHERE c.empresa_id = p_empresa_id
   RETURNING c.ultimo_numero INTO v_num;

  IF v_num IS NULL THEN
    RAISE EXCEPTION 'No se pudo reservar correlativo de gasto';
  END IF;
  RETURN 'GS-' || lpad(v_num::text, 6, '0');
END;
$f$;

GRANT EXECUTE ON FUNCTION neura.next_numero_gasto_empresa(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION neura.next_numero_gasto_empresa(uuid) TO authenticated;

-- ── 4) Módulo/permiso contabilidad ───────────────────────────────────────────
INSERT INTO neura.modulos (id, nombre, slug, descripcion)
SELECT gen_random_uuid(), 'Contabilidad', 'contabilidad', 'Gastos y Servicios, Libro de Compras y contabilidad'
WHERE NOT EXISTS (SELECT 1 FROM neura.modulos WHERE slug = 'contabilidad');

DO $$
DECLARE v_hist int; v_items_tbl int;
BEGIN
  SELECT count(*) INTO v_hist FROM neura.gastos WHERE estado='historico';
  SELECT count(*) INTO v_items_tbl FROM information_schema.tables WHERE table_schema='neura' AND table_name='gasto_items';
  RAISE NOTICE 'fase1: gastos_historicos=% gasto_items_tabla=% modulo_contabilidad=%',
    v_hist, v_items_tbl, (SELECT count(*) FROM neura.modulos WHERE slug='contabilidad');
END $$;

COMMIT;
