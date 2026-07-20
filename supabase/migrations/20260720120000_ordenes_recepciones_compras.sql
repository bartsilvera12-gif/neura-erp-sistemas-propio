-- =============================================================================
-- ÓRDENES DE COMPRA → RECEPCIONES → COMPRAS (multilínea) → INVENTARIO/CONTABILIDAD
-- SOLO schema `neura`. Idempotente. No borra ni altera compras/movimientos históricos.
--
-- Regla central:
--   RECEPCIÓN  = movimiento físico  → único movimiento_inventario (documento_tipo='recepcion')
--   COMPRA     = movimiento fiscal/contable → asiento + libros; afecta_stock=false si viene
--                de una recepción (el stock ya entró con la recepción).
-- =============================================================================

BEGIN;

-- ── 1) Órdenes de compra (cabecera) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.ordenes_compra (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  numero            text NOT NULL,
  proveedor_id      uuid NOT NULL REFERENCES neura.proveedores(id) ON DELETE RESTRICT,
  proveedor_nombre  text,
  fecha             date NOT NULL DEFAULT current_date,
  fecha_estimada    date,
  observaciones     text,
  moneda            text NOT NULL DEFAULT 'PYG',
  tipo_cambio       numeric NOT NULL DEFAULT 1,
  total_estimado    numeric NOT NULL DEFAULT 0,
  estado            text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','aprobada','parcialmente_recibida','recibida','cerrada','cancelada')),
  aprobada_by       uuid,
  aprobada_at       timestamptz,
  cancelada_by      uuid,
  cancelada_at      timestamptz,
  motivo_cancelacion text,
  cerrada_by        uuid,
  cerrada_at        timestamptz,
  motivo_cierre     text,
  cierre_automatico boolean NOT NULL DEFAULT false,
  idempotency_key   uuid,
  created_by        uuid,
  usuario_nombre    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ordenes_compra_numero_uk UNIQUE (empresa_id, numero)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_compra_idem
  ON neura.ordenes_compra (empresa_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ordenes_compra_estado ON neura.ordenes_compra (empresa_id, estado, fecha DESC);

-- ── 2) Ítems de la orden ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.orden_compra_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  orden_id                 uuid NOT NULL REFERENCES neura.ordenes_compra(id) ON DELETE CASCADE,
  producto_id              uuid REFERENCES neura.productos(id) ON DELETE RESTRICT,
  producto_nombre          text,
  descripcion              text,
  cantidad                 numeric NOT NULL CHECK (cantidad > 0),
  costo_unitario_estimado  numeric NOT NULL DEFAULT 0 CHECK (costo_unitario_estimado >= 0),
  iva_tipo                 text NOT NULL DEFAULT '10' CHECK (iva_tipo IN ('exenta','5','10')),
  cuenta_contable_id       uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  orden_linea              integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_oci_orden ON neura.orden_compra_items (orden_id);

-- ── 3) Recepciones (cabecera) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.recepciones (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  numero               text NOT NULL,
  orden_id             uuid NOT NULL REFERENCES neura.ordenes_compra(id) ON DELETE RESTRICT,
  proveedor_id         uuid REFERENCES neura.proveedores(id) ON DELETE SET NULL,
  proveedor_nombre     text,
  fecha                date NOT NULL DEFAULT current_date,
  ubicacion_id         uuid REFERENCES neura.inventario_ubicaciones(id) ON DELETE SET NULL,
  observacion          text,
  documento_url        text,
  estado               text NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada','anulada')),
  -- Facturación: se recalcula al facturar (pendiente → parcial → facturada).
  estado_facturacion   text NOT NULL DEFAULT 'pendiente'
                       CHECK (estado_facturacion IN ('pendiente','parcial','facturada')),
  excedente_confirmado boolean NOT NULL DEFAULT false,
  motivo_excedente     text,
  idempotency_key      uuid,
  created_by           uuid,
  usuario_nombre       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recepciones_numero_uk UNIQUE (empresa_id, numero)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recepciones_idem
  ON neura.recepciones (empresa_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_recepciones_orden ON neura.recepciones (empresa_id, orden_id);
CREATE INDEX IF NOT EXISTS ix_recepciones_fact  ON neura.recepciones (empresa_id, estado_facturacion);

-- ── 4) Ítems de recepción ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.recepcion_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  recepcion_id             uuid NOT NULL REFERENCES neura.recepciones(id) ON DELETE CASCADE,
  orden_item_id            uuid REFERENCES neura.orden_compra_items(id) ON DELETE RESTRICT,
  producto_id              uuid REFERENCES neura.productos(id) ON DELETE RESTRICT,
  producto_nombre          text,
  cantidad_recibida        numeric NOT NULL CHECK (cantidad_recibida > 0),
  costo_unitario_recibido  numeric NOT NULL DEFAULT 0 CHECK (costo_unitario_recibido >= 0),
  -- Control anti doble-facturación: nunca puede superar cantidad_recibida.
  cantidad_facturada       numeric NOT NULL DEFAULT 0 CHECK (cantidad_facturada >= 0),
  movimiento_id            uuid REFERENCES neura.movimientos_inventario(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recitem_facturada_lte_recibida CHECK (cantidad_facturada <= cantidad_recibida)
);
CREATE INDEX IF NOT EXISTS ix_reci_recepcion ON neura.recepcion_items (recepcion_id);
CREATE INDEX IF NOT EXISTS ix_reci_ordenitem ON neura.recepcion_items (orden_item_id);

-- ── 5) Compras: multilínea + vínculo a la orden ──────────────────────────────
ALTER TABLE neura.compras
  ADD COLUMN IF NOT EXISTS orden_compra_id uuid REFERENCES neura.ordenes_compra(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origen_compra   text NOT NULL DEFAULT 'directa';

DO $$ BEGIN
  ALTER TABLE neura.compras ADD CONSTRAINT compras_origen_chk
    CHECK (origen_compra IN ('directa','recepcion'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_compras_orden ON neura.compras (empresa_id, orden_compra_id);

CREATE TABLE IF NOT EXISTS neura.compra_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  compra_id           uuid NOT NULL REFERENCES neura.compras(id) ON DELETE CASCADE,
  producto_id         uuid REFERENCES neura.productos(id) ON DELETE RESTRICT,
  producto_nombre     text,
  descripcion         text,
  cantidad            numeric NOT NULL CHECK (cantidad > 0),
  costo_unitario      numeric NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  iva_tipo            text NOT NULL DEFAULT '10' CHECK (iva_tipo IN ('exenta','5','10')),
  subtotal            numeric NOT NULL DEFAULT 0,
  monto_iva           numeric NOT NULL DEFAULT 0,
  total_linea         numeric NOT NULL DEFAULT 0,
  cuenta_contable_id  uuid REFERENCES neura.plan_cuentas(id) ON DELETE RESTRICT,
  recepcion_item_id   uuid REFERENCES neura.recepcion_items(id) ON DELETE RESTRICT,
  -- false cuando la línea proviene de una recepción (el stock ya entró) o es histórica.
  afecta_inventario   boolean NOT NULL DEFAULT false,
  -- Trazabilidad de diferencias de precio ordenado vs facturado.
  costo_unitario_ordenado numeric,
  costo_unitario_recibido numeric,
  orden_linea         integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ci_compra    ON neura.compra_items (compra_id);
CREATE INDEX IF NOT EXISTS ix_ci_recitem   ON neura.compra_items (empresa_id, recepcion_item_id);

-- ── 6) Correlativos OC-XXXXXX y REC-XXXXXX ───────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.orden_correlativos (
  empresa_id    uuid PRIMARY KEY REFERENCES neura.empresas(id) ON DELETE CASCADE,
  ultimo_numero bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS neura.recepcion_correlativos (
  empresa_id    uuid PRIMARY KEY REFERENCES neura.empresas(id) ON DELETE CASCADE,
  ultimo_numero bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION neura.next_numero_orden_empresa(p_empresa_id uuid)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_num bigint;
BEGIN
  IF p_empresa_id IS NULL THEN RAISE EXCEPTION 'next_numero_orden_empresa: empresa_id es obligatorio'; END IF;
  INSERT INTO neura.orden_correlativos (empresa_id, ultimo_numero) VALUES (p_empresa_id, 0)
    ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE neura.orden_correlativos c SET ultimo_numero = c.ultimo_numero + 1, updated_at = now()
   WHERE c.empresa_id = p_empresa_id RETURNING c.ultimo_numero INTO v_num;
  IF v_num IS NULL THEN RAISE EXCEPTION 'No se pudo reservar correlativo de orden'; END IF;
  RETURN 'OC-' || lpad(v_num::text, 6, '0');
END; $f$;

CREATE OR REPLACE FUNCTION neura.next_numero_recepcion_empresa(p_empresa_id uuid)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_num bigint;
BEGIN
  IF p_empresa_id IS NULL THEN RAISE EXCEPTION 'next_numero_recepcion_empresa: empresa_id es obligatorio'; END IF;
  INSERT INTO neura.recepcion_correlativos (empresa_id, ultimo_numero) VALUES (p_empresa_id, 0)
    ON CONFLICT (empresa_id) DO NOTHING;
  UPDATE neura.recepcion_correlativos c SET ultimo_numero = c.ultimo_numero + 1, updated_at = now()
   WHERE c.empresa_id = p_empresa_id RETURNING c.ultimo_numero INTO v_num;
  IF v_num IS NULL THEN RAISE EXCEPTION 'No se pudo reservar correlativo de recepción'; END IF;
  RETURN 'REC-' || lpad(v_num::text, 6, '0');
END; $f$;

-- ── 7) RLS + grants + triggers para las tablas nuevas ────────────────────────
DO $$
DECLARE t text; pre text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ordenes_compra','orden_compra_items','recepciones','recepcion_items',
                           'compra_items','orden_correlativos','recepcion_correlativos']
  LOOP
    EXECUTE format('ALTER TABLE neura.%I ENABLE ROW LEVEL SECURITY', t);
    pre := left(replace(t, '_', ''), 20);
    EXECUTE format('DROP POLICY IF EXISTS %I ON neura.%I', pre || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON neura.%I FOR SELECT USING (neura.puede_acceder_empresa(empresa_id))', pre || '_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON neura.%I', pre || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON neura.%I FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id))', pre || '_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON neura.%I', pre || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON neura.%I FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id))', pre || '_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON neura.%I', pre || '_del', t);
    EXECUTE format('CREATE POLICY %I ON neura.%I FOR DELETE USING (neura.puede_acceder_empresa(empresa_id))', pre || '_del', t);
    EXECUTE format('GRANT SELECT ON neura.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON neura.%I TO authenticated, service_role', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON neura.%I', 'tr_' || pre || '_upd', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON neura.%I FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at()', 'tr_' || pre || '_upd', t);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION neura.next_numero_orden_empresa(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION neura.next_numero_recepcion_empresa(uuid) TO authenticated, service_role;

-- ── 8) Backfill compatible de compras históricas (monoproducto → 1 ítem) ─────
-- afecta_inventario = false: su stock YA fue impactado en su momento; el ítem es
-- solo la representación multilínea. No se crean movimientos ni se toca stock.
INSERT INTO neura.compra_items (
  empresa_id, compra_id, producto_id, producto_nombre, descripcion, cantidad,
  costo_unitario, iva_tipo, subtotal, monto_iva, total_linea, cuenta_contable_id,
  recepcion_item_id, afecta_inventario, orden_linea
)
SELECT c.empresa_id, c.id, c.producto_id, c.producto_nombre, c.producto_nombre,
       COALESCE(NULLIF(c.cantidad, 0), 1), COALESCE(c.costo_unitario, 0),
       CASE WHEN c.iva_tipo IN ('exenta','5','10') THEN c.iva_tipo ELSE '10' END,
       COALESCE(c.subtotal, 0), COALESCE(c.monto_iva, 0), COALESCE(c.total, 0),
       c.cuenta_contable_id, NULL, false, 1
  FROM neura.compras c
 WHERE NOT EXISTS (SELECT 1 FROM neura.compra_items ci WHERE ci.compra_id = c.id);

DO $$
DECLARE v_t int; v_ci int;
BEGIN
  SELECT count(*) INTO v_t FROM information_schema.tables
   WHERE table_schema='neura' AND table_name IN
     ('ordenes_compra','orden_compra_items','recepciones','recepcion_items','compra_items');
  SELECT count(*) INTO v_ci FROM neura.compra_items;
  RAISE NOTICE 'ordenes/recepciones: tablas_creadas=% compra_items=%', v_t, v_ci;
END $$;

COMMIT;
