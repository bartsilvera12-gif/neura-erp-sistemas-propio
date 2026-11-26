-- =============================================================================
-- Inventario 2.0 en Neura — fase 1: stock por depósito, ajustes y traslados.
--
-- Traído del ERP 2.0 (recetas 50/14) y adaptado a Neura:
--   · Los "depósitos" son las `inventario_ubicaciones` que ya existen.
--   · El stock por depósito vive en `inventario_stock_ubicacion` (ya existe).
--   · `productos.stock_actual` sigue siendo el total: lo leen el tablero, el libro de
--     compras y los reportes, así que no se toca su significado.
--
-- Regla nueva: total del producto = suma de sus depósitos. Se cumple por dos caminos:
--   1. Todo lo nuevo (ajustes, traslados) mueve stock con `inv_mover`, que actualiza
--      el depósito, el total y deja el movimiento, en la misma transacción.
--   2. Lo que todavía cambia `productos.stock_actual` directo (compras, recepciones,
--      importador, alta de producto) lo agarra el trigger `inv_sync_deposito` y lleva la
--      diferencia al depósito que corresponda. Así nada queda desfasado aunque esos
--      caminos todavía no estén migrados.
--
-- Todo es aditivo: no se borra ni se renombra ninguna columna ni tabla existente.
-- Solo schema `neura`. No toca facturas, pagos, compras ni asientos.
-- =============================================================================

BEGIN;

-- ─── 1. Depósito predeterminado ───────────────────────────────────────────────
ALTER TABLE neura.inventario_ubicaciones
  ADD COLUMN IF NOT EXISTS es_predeterminado boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ubicaciones_predeterminada
  ON neura.inventario_ubicaciones (empresa_id) WHERE es_predeterminado;

-- Cada empresa con depósitos y sin predeterminado: el activo más viejo pasa a serlo.
UPDATE neura.inventario_ubicaciones u
   SET es_predeterminado = true
 WHERE u.id IN (
   SELECT DISTINCT ON (x.empresa_id) x.id
     FROM neura.inventario_ubicaciones x
    WHERE x.activo IS DISTINCT FROM false
      AND NOT EXISTS (SELECT 1 FROM neura.inventario_ubicaciones y
                       WHERE y.empresa_id = x.empresa_id AND y.es_predeterminado)
    ORDER BY x.empresa_id, x.created_at, x.id
 );

-- El depósito por defecto de una empresa. Si no tiene ninguno, se crea "CENTRAL".
CREATE OR REPLACE FUNCTION neura.inv_deposito_predeterminado(p_empresa uuid)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM neura.inventario_ubicaciones
   WHERE empresa_id = p_empresa AND es_predeterminado LIMIT 1;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM neura.inventario_ubicaciones
     WHERE empresa_id = p_empresa AND activo IS DISTINCT FROM false
     ORDER BY created_at, id LIMIT 1;
    IF v_id IS NOT NULL THEN
      UPDATE neura.inventario_ubicaciones SET es_predeterminado = true WHERE id = v_id;
    ELSE
      INSERT INTO neura.inventario_ubicaciones (empresa_id, nombre, tipo, activo, es_predeterminado)
      VALUES (p_empresa, 'CENTRAL', 'deposito', true, true)
      RETURNING id INTO v_id;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;

-- ─── 2. Movimientos: depósito, contraparte y número de documento ─────────────
ALTER TABLE neura.movimientos_inventario
  ADD COLUMN IF NOT EXISTS ubicacion_id uuid REFERENCES neura.inventario_ubicaciones(id),
  ADD COLUMN IF NOT EXISTS ubicacion_contraparte_id uuid REFERENCES neura.inventario_ubicaciones(id),
  ADD COLUMN IF NOT EXISTS documento_numero text,
  ADD COLUMN IF NOT EXISTS saldo_deposito numeric;

CREATE INDEX IF NOT EXISTS idx_movimientos_ubicacion ON neura.movimientos_inventario (ubicacion_id);

ALTER TABLE neura.movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check;
ALTER TABLE neura.movimientos_inventario ADD CONSTRAINT movimientos_inventario_origen_check
  CHECK (origen = ANY (ARRAY[
    'compra', 'venta', 'ajuste_manual', 'inventario_inicial', 'recepcion',
    'ajuste', 'perdida', 'anulacion_ajuste',
    'traslado_salida', 'traslado_entrada', 'anulacion_traslado'
  ]));

-- ─── 3. El motor: mover stock de un producto en un depósito ──────────────────
-- Suma (o resta) `p_delta` en el depósito, ajusta el total del producto y deja el
-- movimiento. No deja stock negativo en el depósito. Devuelve el saldo del depósito.
CREATE OR REPLACE FUNCTION neura.inv_mover(
  p_empresa uuid, p_producto uuid, p_ubicacion uuid, p_delta numeric, p_costo numeric,
  p_origen text, p_doc_tipo text, p_doc_id uuid, p_doc_numero text, p_referencia text,
  p_usuario uuid, p_usuario_nombre text, p_contraparte uuid DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql AS $fn$
DECLARE
  prod record;
  v_dep text;
  v_actual numeric;
  v_nuevo numeric;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN RETURN NULL; END IF;
  SELECT id, nombre, sku INTO prod FROM neura.productos
   WHERE id = p_producto AND empresa_id = p_empresa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  SELECT nombre INTO v_dep FROM neura.inventario_ubicaciones
   WHERE id = p_ubicacion AND empresa_id = p_empresa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depósito no encontrado'; END IF;

  INSERT INTO neura.inventario_stock_ubicacion (empresa_id, producto_id, ubicacion_id, stock_actual)
  VALUES (p_empresa, p_producto, p_ubicacion, 0)
  ON CONFLICT (empresa_id, producto_id, ubicacion_id) DO NOTHING;

  SELECT stock_actual INTO v_actual FROM neura.inventario_stock_ubicacion
   WHERE empresa_id = p_empresa AND producto_id = p_producto AND ubicacion_id = p_ubicacion FOR UPDATE;
  v_nuevo := COALESCE(v_actual, 0) + p_delta;
  IF v_nuevo < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente de "%" en %: hay %, se necesitan %',
      prod.nombre, v_dep, trim_scale(COALESCE(v_actual, 0)), trim_scale(abs(p_delta));
  END IF;

  UPDATE neura.inventario_stock_ubicacion SET stock_actual = v_nuevo, updated_at = now()
   WHERE empresa_id = p_empresa AND producto_id = p_producto AND ubicacion_id = p_ubicacion;

  -- El total cambia acá mismo; el trigger de sincronización se salta este cambio.
  PERFORM set_config('neura.inv_mover', '1', true);
  UPDATE neura.productos SET stock_actual = COALESCE(stock_actual, 0) + p_delta, updated_at = now()
   WHERE id = p_producto;
  PERFORM set_config('neura.inv_mover', '', true);

  INSERT INTO neura.movimientos_inventario (
    empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario,
    origen, referencia, fecha, created_by, usuario_nombre, documento_tipo, documento_id,
    documento_numero, ubicacion_id, ubicacion_contraparte_id, saldo_deposito)
  VALUES (
    p_empresa, p_producto, prod.nombre, prod.sku,
    CASE WHEN p_delta > 0 THEN 'ENTRADA' ELSE 'SALIDA' END, abs(p_delta), COALESCE(p_costo, 0),
    p_origen, left(p_referencia, 200), clock_timestamp(), p_usuario, p_usuario_nombre, p_doc_tipo, p_doc_id,
    p_doc_numero, p_ubicacion, p_contraparte, v_nuevo);
  RETURN v_nuevo;
END;
$fn$;

-- ─── 4. Red de seguridad para los caminos viejos ─────────────────────────────
-- Cuando algo cambia `productos.stock_actual` sin pasar por `inv_mover`, la diferencia
-- va al depósito indicado en `neura.inv_ubicacion` (si el código lo fijó), si no al
-- depósito principal del producto, y si no al predeterminado. Acá no se bloquea
-- negativo: esos caminos ya validan su stock y no hay que romperlos.
CREATE OR REPLACE FUNCTION neura.inv_sync_deposito()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_delta numeric;
  v_ubic uuid;
BEGIN
  IF current_setting('neura.inv_mover', true) = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    v_delta := COALESCE(NEW.stock_actual, 0);
  ELSE
    v_delta := COALESCE(NEW.stock_actual, 0) - COALESCE(OLD.stock_actual, 0);
  END IF;
  IF v_delta = 0 THEN RETURN NEW; END IF;

  v_ubic := NULLIF(current_setting('neura.inv_ubicacion', true), '')::uuid;
  IF v_ubic IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM neura.inventario_ubicaciones WHERE id = v_ubic AND empresa_id = NEW.empresa_id) THEN
    v_ubic := NULL;
  END IF;
  v_ubic := COALESCE(v_ubic, NEW.ubicacion_principal_id, neura.inv_deposito_predeterminado(NEW.empresa_id));

  INSERT INTO neura.inventario_stock_ubicacion (empresa_id, producto_id, ubicacion_id, stock_actual)
  VALUES (NEW.empresa_id, NEW.id, v_ubic, v_delta)
  ON CONFLICT (empresa_id, producto_id, ubicacion_id)
  DO UPDATE SET stock_actual = neura.inventario_stock_ubicacion.stock_actual + EXCLUDED.stock_actual,
                updated_at = now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_inv_sync_deposito_upd ON neura.productos;
CREATE TRIGGER trg_inv_sync_deposito_upd
AFTER UPDATE OF stock_actual ON neura.productos
FOR EACH ROW EXECUTE FUNCTION neura.inv_sync_deposito();

DROP TRIGGER IF EXISTS trg_inv_sync_deposito_ins ON neura.productos;
CREATE TRIGGER trg_inv_sync_deposito_ins
AFTER INSERT ON neura.productos
FOR EACH ROW EXECUTE FUNCTION neura.inv_sync_deposito();

-- ─── 5. Ajustes y pérdidas ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neura.inventario_ajustes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('ajuste', 'perdida')),
  numero text NOT NULL,
  ubicacion_id uuid NOT NULL REFERENCES neura.inventario_ubicaciones(id),
  motivo text NOT NULL,
  detalle text,
  estado text NOT NULL DEFAULT 'aplicado' CHECK (estado IN ('aplicado', 'anulado')),
  total_unidades numeric NOT NULL DEFAULT 0,
  total_valor numeric NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_ajustes_idem
  ON neura.inventario_ajustes (empresa_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_ajustes_empresa_fecha ON neura.inventario_ajustes (empresa_id, created_at DESC);

CREATE TABLE IF NOT EXISTS neura.inventario_ajustes_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  ajuste_id uuid NOT NULL REFERENCES neura.inventario_ajustes(id) ON DELETE CASCADE,
  orden integer NOT NULL,
  producto_id uuid NOT NULL REFERENCES neura.productos(id),
  producto_nombre text NOT NULL,
  producto_sku text,
  modo text NOT NULL CHECK (modo IN ('conteo', 'diferencia')),
  stock_anterior numeric NOT NULL,
  cantidad_contada numeric,
  diferencia numeric NOT NULL,
  costo_unitario numeric NOT NULL DEFAULT 0,
  nota text
);
CREATE INDEX IF NOT EXISTS idx_inv_ajustes_items_ajuste ON neura.inventario_ajustes_items (ajuste_id);

-- Siguiente número de un documento (AJ-000001, PE-000001, TR-000001), con candado
-- por empresa y tipo para que dos cargas a la vez no repitan número.
CREATE OR REPLACE FUNCTION neura.inv_siguiente_numero(p_empresa uuid, p_prefijo text, p_tabla text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_max bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inv_num:' || p_empresa::text || ':' || p_prefijo, 0));
  EXECUTE format(
    'SELECT max(substring(numero from ''[0-9]+$'')::bigint) FROM neura.%I WHERE empresa_id = $1 AND numero LIKE $2',
    p_tabla)
  INTO v_max USING p_empresa, p_prefijo || '-%';
  RETURN p_prefijo || '-' || lpad((COALESCE(v_max, 0) + 1)::text, 6, '0');
END;
$fn$;

-- p: { tipo, ubicacion_id, motivo, detalle, idempotency_key, items: [{producto_id, modo, cantidad, nota}] }
--   modo 'conteo': `cantidad` es lo que se contó; la diferencia la calcula la base.
--   modo 'diferencia': `cantidad` es cuánto sumar (o restar, en negativo).
--   tipo 'perdida': siempre resta `cantidad` (positiva).
CREATE OR REPLACE FUNCTION neura.inv_registrar_ajuste(
  p_empresa uuid, p_usuario uuid, p_usuario_nombre text, p jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_tipo text := COALESCE(NULLIF(p->>'tipo', ''), 'ajuste');
  v_motivo text := NULLIF(btrim(COALESCE(p->>'motivo', '')), '');
  v_detalle text := NULLIF(left(btrim(COALESCE(p->>'detalle', '')), 500), '');
  v_idem uuid := NULLIF(p->>'idempotency_key', '')::uuid;
  v_ubic uuid := NULLIF(p->>'ubicacion_id', '')::uuid;
  v_rep record;
  v_id uuid;
  v_numero text;
  it jsonb;
  prod record;
  v_modo text;
  v_cant numeric;
  v_ant numeric;
  v_dif numeric;
  v_orden integer := 0;
  v_vistos uuid[] := '{}';
  v_u numeric := 0;
  v_v numeric := 0;
  v_ref text;
BEGIN
  IF v_tipo NOT IN ('ajuste', 'perdida') THEN RAISE EXCEPTION 'Tipo de documento inválido'; END IF;
  IF v_tipo = 'ajuste' AND v_motivo NOT IN ('conteo_fisico', 'inventario_inicial', 'correccion', 'otro') THEN
    RAISE EXCEPTION 'Elegí el motivo del ajuste';
  END IF;
  IF v_tipo = 'perdida' AND v_motivo NOT IN ('rotura', 'devolucion_cliente', 'devolucion_proveedor',
                                             'faltante', 'consumo_interno', 'garantia', 'otro') THEN
    RAISE EXCEPTION 'Elegí el motivo de la pérdida';
  END IF;
  IF v_motivo = 'otro' AND v_detalle IS NULL THEN RAISE EXCEPTION 'Contá el motivo en el detalle'; END IF;

  IF v_idem IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ajuste:' || p_empresa::text || ':' || v_idem::text, 0));
    SELECT id, numero INTO v_rep FROM neura.inventario_ajustes
     WHERE empresa_id = p_empresa AND idempotency_key = v_idem;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_rep.id, 'numero', v_rep.numero, 'repetido', true);
    END IF;
  END IF;

  v_ubic := COALESCE(v_ubic, neura.inv_deposito_predeterminado(p_empresa));
  IF NOT EXISTS (SELECT 1 FROM neura.inventario_ubicaciones WHERE id = v_ubic AND empresa_id = p_empresa) THEN
    RAISE EXCEPTION 'Depósito no encontrado';
  END IF;
  IF jsonb_typeof(p->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'items') = 0 THEN
    RAISE EXCEPTION 'El documento no tiene productos';
  END IF;
  IF jsonb_array_length(p->'items') > 500 THEN RAISE EXCEPTION 'Máximo 500 productos por documento'; END IF;

  v_numero := neura.inv_siguiente_numero(p_empresa, CASE v_tipo WHEN 'ajuste' THEN 'AJ' ELSE 'PE' END,
                                         'inventario_ajustes');
  INSERT INTO neura.inventario_ajustes (empresa_id, tipo, numero, ubicacion_id, motivo, detalle,
                                        idempotency_key, created_by, usuario_nombre)
  VALUES (p_empresa, v_tipo, v_numero, v_ubic, v_motivo, v_detalle, v_idem, p_usuario, p_usuario_nombre)
  RETURNING id INTO v_id;

  v_ref := CASE v_tipo WHEN 'ajuste' THEN 'Ajuste ' ELSE 'Pérdida ' END || v_numero;
  FOR it IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
    v_orden := v_orden + 1;
    SELECT id, nombre, sku, costo_promedio INTO prod FROM neura.productos
     WHERE id = NULLIF(it->>'producto_id', '')::uuid AND empresa_id = p_empresa;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto % no encontrado', v_orden; END IF;
    IF prod.id = ANY (v_vistos) THEN RAISE EXCEPTION '"%" está dos veces en el documento', prod.nombre; END IF;
    v_vistos := v_vistos || prod.id;

    v_modo := CASE WHEN v_tipo = 'perdida' THEN 'diferencia' ELSE COALESCE(NULLIF(it->>'modo', ''), 'diferencia') END;
    IF v_modo NOT IN ('conteo', 'diferencia') THEN RAISE EXCEPTION '"%": modo inválido', prod.nombre; END IF;
    v_cant := NULLIF(it->>'cantidad', '')::numeric;
    IF v_cant IS NULL THEN RAISE EXCEPTION '"%": falta la cantidad', prod.nombre; END IF;

    SELECT COALESCE(stock_actual, 0) INTO v_ant FROM neura.inventario_stock_ubicacion
     WHERE empresa_id = p_empresa AND producto_id = prod.id AND ubicacion_id = v_ubic;
    v_ant := COALESCE(v_ant, 0);

    IF v_modo = 'conteo' THEN
      IF v_cant < 0 THEN RAISE EXCEPTION '"%": el conteo no puede ser negativo', prod.nombre; END IF;
      v_dif := v_cant - v_ant;
    ELSIF v_tipo = 'perdida' THEN
      IF v_cant <= 0 THEN RAISE EXCEPTION '"%": la cantidad perdida tiene que ser mayor a 0', prod.nombre; END IF;
      v_dif := -v_cant;
    ELSE
      IF v_cant = 0 THEN RAISE EXCEPTION '"%": la diferencia no puede ser 0', prod.nombre; END IF;
      v_dif := v_cant;
    END IF;

    INSERT INTO neura.inventario_ajustes_items (empresa_id, ajuste_id, orden, producto_id, producto_nombre,
      producto_sku, modo, stock_anterior, cantidad_contada, diferencia, costo_unitario, nota)
    VALUES (p_empresa, v_id, v_orden, prod.id, prod.nombre, prod.sku, v_modo, v_ant,
            CASE WHEN v_modo = 'conteo' THEN v_cant END, v_dif, COALESCE(prod.costo_promedio, 0),
            NULLIF(left(btrim(COALESCE(it->>'nota', '')), 200), ''));

    IF v_dif <> 0 THEN
      PERFORM neura.inv_mover(p_empresa, prod.id, v_ubic, v_dif, prod.costo_promedio, v_tipo, 'ajuste',
                              v_id, v_numero, v_ref, p_usuario, p_usuario_nombre);
    END IF;
    v_u := v_u + v_dif;
    v_v := v_v + v_dif * COALESCE(prod.costo_promedio, 0);
  END LOOP;

  UPDATE neura.inventario_ajustes SET total_unidades = v_u, total_valor = round(v_v) WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'numero', v_numero, 'repetido', false);
END;
$fn$;

-- Anular un ajuste: devuelve cada diferencia al depósito. Falla si ya no hay stock
-- para devolver (por ejemplo, lo que entró ya se vendió).
CREATE OR REPLACE FUNCTION neura.inv_anular_ajuste(
  p_empresa uuid, p_usuario uuid, p_usuario_nombre text, p_id uuid, p_motivo text
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  a record;
  ai record;
  v_ref text;
BEGIN
  IF COALESCE(btrim(p_motivo), '') = '' THEN RAISE EXCEPTION 'Escribí el motivo de la anulación'; END IF;
  SELECT * INTO a FROM neura.inventario_ajustes WHERE id = p_id AND empresa_id = p_empresa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento no encontrado'; END IF;
  IF a.estado = 'anulado' THEN RAISE EXCEPTION 'El documento % ya está anulado', a.numero; END IF;
  v_ref := left('Anulación ' || a.numero || ': ' || btrim(p_motivo), 200);
  FOR ai IN SELECT * FROM neura.inventario_ajustes_items WHERE ajuste_id = a.id ORDER BY orden LOOP
    IF ai.diferencia <> 0 THEN
      PERFORM neura.inv_mover(p_empresa, ai.producto_id, a.ubicacion_id, -ai.diferencia, ai.costo_unitario,
                              'anulacion_ajuste', 'ajuste_anulacion', a.id, a.numero, v_ref,
                              p_usuario, p_usuario_nombre);
    END IF;
  END LOOP;
  UPDATE neura.inventario_ajustes
     SET estado = 'anulado', anulado_por = p_usuario, anulado_por_nombre = p_usuario_nombre,
         anulado_at = now(), anulado_motivo = left(btrim(p_motivo), 500)
   WHERE id = a.id;
  RETURN jsonb_build_object('id', a.id, 'numero', a.numero, 'estado', 'anulado');
END;
$fn$;

-- ─── 6. Traslados entre depósitos ─────────────────────────────────────────────
-- Salen del origen al crearlos (quedan "en tránsito") y entran al destino al recibirlos.
CREATE TABLE IF NOT EXISTS neura.inventario_traslados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  numero text NOT NULL,
  ubicacion_origen_id uuid NOT NULL REFERENCES neura.inventario_ubicaciones(id),
  ubicacion_destino_id uuid NOT NULL REFERENCES neura.inventario_ubicaciones(id),
  estado text NOT NULL DEFAULT 'en_transito'
    CHECK (estado IN ('en_transito', 'recibido', 'recibido_con_diferencias', 'anulado')),
  observacion text,
  idempotency_key uuid,
  total_unidades numeric NOT NULL DEFAULT 0,
  diferencia_unidades numeric NOT NULL DEFAULT 0,
  diferencia_motivo text,
  created_by uuid,
  usuario_nombre text,
  created_at timestamptz NOT NULL DEFAULT now(),
  recibido_por uuid,
  recibido_por_nombre text,
  recibido_at timestamptz,
  anulado_por uuid,
  anulado_por_nombre text,
  anulado_at timestamptz,
  anulado_motivo text,
  UNIQUE (empresa_id, numero),
  CHECK (ubicacion_origen_id <> ubicacion_destino_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_traslados_idem
  ON neura.inventario_traslados (empresa_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_traslados_empresa_fecha ON neura.inventario_traslados (empresa_id, created_at DESC);

CREATE TABLE IF NOT EXISTS neura.inventario_traslados_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  traslado_id uuid NOT NULL REFERENCES neura.inventario_traslados(id) ON DELETE CASCADE,
  orden integer NOT NULL,
  producto_id uuid NOT NULL REFERENCES neura.productos(id),
  producto_nombre text NOT NULL,
  producto_sku text,
  cantidad numeric NOT NULL CHECK (cantidad > 0),
  cantidad_recibida numeric,
  costo_unitario numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inv_traslados_items_traslado ON neura.inventario_traslados_items (traslado_id);

-- p: { ubicacion_origen_id, ubicacion_destino_id, observacion, idempotency_key,
--      items: [{producto_id, cantidad}] }
CREATE OR REPLACE FUNCTION neura.inv_crear_traslado(
  p_empresa uuid, p_usuario uuid, p_usuario_nombre text, p jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_idem uuid := NULLIF(p->>'idempotency_key', '')::uuid;
  v_o uuid := NULLIF(p->>'ubicacion_origen_id', '')::uuid;
  v_d uuid := NULLIF(p->>'ubicacion_destino_id', '')::uuid;
  v_dn text;
  v_rep record;
  v_id uuid;
  v_numero text;
  it jsonb;
  prod record;
  v_cant numeric;
  v_orden integer := 0;
  v_vistos uuid[] := '{}';
  v_u numeric := 0;
BEGIN
  IF v_idem IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('traslado:' || p_empresa::text || ':' || v_idem::text, 0));
    SELECT id, numero INTO v_rep FROM neura.inventario_traslados
     WHERE empresa_id = p_empresa AND idempotency_key = v_idem;
    IF FOUND THEN RETURN jsonb_build_object('id', v_rep.id, 'numero', v_rep.numero, 'repetido', true); END IF;
  END IF;
  IF v_o IS NULL OR v_d IS NULL THEN RAISE EXCEPTION 'Elegí el depósito de origen y el de destino'; END IF;
  IF v_o = v_d THEN RAISE EXCEPTION 'El depósito de origen y el de destino tienen que ser distintos'; END IF;
  IF NOT EXISTS (SELECT 1 FROM neura.inventario_ubicaciones WHERE id = v_o AND empresa_id = p_empresa) THEN
    RAISE EXCEPTION 'Depósito de origen no encontrado';
  END IF;
  SELECT nombre INTO v_dn FROM neura.inventario_ubicaciones WHERE id = v_d AND empresa_id = p_empresa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depósito de destino no encontrado'; END IF;
  IF jsonb_typeof(p->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'items') = 0 THEN
    RAISE EXCEPTION 'El traslado no tiene productos';
  END IF;
  IF jsonb_array_length(p->'items') > 300 THEN RAISE EXCEPTION 'Máximo 300 productos por traslado'; END IF;

  v_numero := neura.inv_siguiente_numero(p_empresa, 'TR', 'inventario_traslados');
  INSERT INTO neura.inventario_traslados (empresa_id, numero, ubicacion_origen_id, ubicacion_destino_id,
    observacion, idempotency_key, created_by, usuario_nombre)
  VALUES (p_empresa, v_numero, v_o, v_d, NULLIF(left(btrim(COALESCE(p->>'observacion', '')), 1000), ''),
          v_idem, p_usuario, p_usuario_nombre)
  RETURNING id INTO v_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
    v_orden := v_orden + 1;
    SELECT id, nombre, sku, costo_promedio INTO prod FROM neura.productos
     WHERE id = NULLIF(it->>'producto_id', '')::uuid AND empresa_id = p_empresa;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto % no encontrado', v_orden; END IF;
    IF prod.id = ANY (v_vistos) THEN RAISE EXCEPTION '"%" está dos veces en el traslado', prod.nombre; END IF;
    v_vistos := v_vistos || prod.id;
    v_cant := NULLIF(it->>'cantidad', '')::numeric;
    IF v_cant IS NULL OR v_cant <= 0 THEN RAISE EXCEPTION '"%": la cantidad tiene que ser mayor a 0', prod.nombre; END IF;

    INSERT INTO neura.inventario_traslados_items (empresa_id, traslado_id, orden, producto_id, producto_nombre,
      producto_sku, cantidad, costo_unitario)
    VALUES (p_empresa, v_id, v_orden, prod.id, prod.nombre, prod.sku, v_cant, COALESCE(prod.costo_promedio, 0));

    PERFORM neura.inv_mover(p_empresa, prod.id, v_o, -v_cant, prod.costo_promedio, 'traslado_salida',
                            'traslado_salida', v_id, v_numero, 'Traslado ' || v_numero || ' → ' || v_dn,
                            p_usuario, p_usuario_nombre, v_d);
    v_u := v_u + v_cant;
  END LOOP;

  UPDATE neura.inventario_traslados SET total_unidades = v_u WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'numero', v_numero, 'repetido', false);
END;
$fn$;

-- p: { items: [{item_id, cantidad_recibida}], diferencia_motivo }
-- Lo que no se indica se da por recibido completo. Si llega menos, hace falta el motivo;
-- lo que no llegó queda registrado como diferencia (no vuelve al origen).
CREATE OR REPLACE FUNCTION neura.inv_recibir_traslado(
  p_empresa uuid, p_usuario uuid, p_usuario_nombre text, p_id uuid, p jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  t record;
  ti record;
  x jsonb;
  v_items jsonb := COALESCE(p->'items', '[]'::jsonb);
  v_rec numeric;
  v_dif numeric := 0;
  v_on text;
  v_motivo text := NULLIF(left(btrim(COALESCE(p->>'diferencia_motivo', '')), 300), '');
BEGIN
  SELECT * INTO t FROM neura.inventario_traslados WHERE id = p_id AND empresa_id = p_empresa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traslado no encontrado'; END IF;
  IF t.estado <> 'en_transito' THEN
    RAISE EXCEPTION 'El traslado % ya está %', t.numero,
      CASE t.estado WHEN 'anulado' THEN 'anulado' ELSE 'recibido' END;
  END IF;
  SELECT nombre INTO v_on FROM neura.inventario_ubicaciones WHERE id = t.ubicacion_origen_id;

  FOR ti IN SELECT * FROM neura.inventario_traslados_items WHERE traslado_id = t.id ORDER BY orden FOR UPDATE LOOP
    SELECT e INTO x FROM jsonb_array_elements(v_items) e WHERE e->>'item_id' = ti.id::text LIMIT 1;
    v_rec := COALESCE(NULLIF(x->>'cantidad_recibida', '')::numeric, ti.cantidad);
    IF v_rec < 0 OR v_rec > ti.cantidad THEN
      RAISE EXCEPTION '"%": lo recibido tiene que estar entre 0 y %', ti.producto_nombre, trim_scale(ti.cantidad);
    END IF;
    IF v_rec > 0 THEN
      PERFORM neura.inv_mover(p_empresa, ti.producto_id, t.ubicacion_destino_id, v_rec, ti.costo_unitario,
                              'traslado_entrada', 'traslado_entrada', t.id, t.numero,
                              'Traslado ' || t.numero || ' ← ' || COALESCE(v_on, ''),
                              p_usuario, p_usuario_nombre, t.ubicacion_origen_id);
    END IF;
    UPDATE neura.inventario_traslados_items SET cantidad_recibida = v_rec WHERE id = ti.id;
    v_dif := v_dif + (ti.cantidad - v_rec);
  END LOOP;

  IF v_dif > 0 AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Llegó menos de lo enviado: escribí el motivo de la diferencia';
  END IF;
  UPDATE neura.inventario_traslados
     SET estado = CASE WHEN v_dif > 0 THEN 'recibido_con_diferencias' ELSE 'recibido' END,
         recibido_por = p_usuario, recibido_por_nombre = p_usuario_nombre, recibido_at = now(),
         diferencia_unidades = v_dif, diferencia_motivo = v_motivo
   WHERE id = t.id;
  RETURN jsonb_build_object('id', t.id, 'numero', t.numero,
    'estado', CASE WHEN v_dif > 0 THEN 'recibido_con_diferencias' ELSE 'recibido' END);
END;
$fn$;

-- Anular un traslado en tránsito: todo vuelve al depósito de origen.
CREATE OR REPLACE FUNCTION neura.inv_anular_traslado(
  p_empresa uuid, p_usuario uuid, p_usuario_nombre text, p_id uuid, p_motivo text
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  t record;
  ti record;
  v_ref text;
BEGIN
  IF COALESCE(btrim(p_motivo), '') = '' THEN RAISE EXCEPTION 'Escribí el motivo de la anulación'; END IF;
  SELECT * INTO t FROM neura.inventario_traslados WHERE id = p_id AND empresa_id = p_empresa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Traslado no encontrado'; END IF;
  IF t.estado <> 'en_transito' THEN
    RAISE EXCEPTION 'Solo se anula un traslado en tránsito (este ya está %)',
      CASE t.estado WHEN 'anulado' THEN 'anulado' ELSE 'recibido' END;
  END IF;
  v_ref := left('Anulación ' || t.numero || ': ' || btrim(p_motivo), 200);
  FOR ti IN SELECT * FROM neura.inventario_traslados_items WHERE traslado_id = t.id ORDER BY orden LOOP
    PERFORM neura.inv_mover(p_empresa, ti.producto_id, t.ubicacion_origen_id, ti.cantidad, ti.costo_unitario,
                            'anulacion_traslado', 'traslado_anulacion', t.id, t.numero, v_ref,
                            p_usuario, p_usuario_nombre, t.ubicacion_destino_id);
  END LOOP;
  UPDATE neura.inventario_traslados
     SET estado = 'anulado', anulado_por = p_usuario, anulado_por_nombre = p_usuario_nombre,
         anulado_at = now(), anulado_motivo = left(btrim(p_motivo), 500)
   WHERE id = t.id;
  RETURN jsonb_build_object('id', t.id, 'numero', t.numero, 'estado', 'anulado');
END;
$fn$;

-- Solo el servidor (pool directo / service role) llama a estas funciones.
REVOKE ALL ON FUNCTION neura.inv_mover(uuid, uuid, uuid, numeric, numeric, text, text, uuid, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION neura.inv_registrar_ajuste(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION neura.inv_anular_ajuste(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION neura.inv_crear_traslado(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION neura.inv_recibir_traslado(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION neura.inv_anular_traslado(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION neura.inv_siguiente_numero(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION neura.inv_deposito_predeterminado(uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE neura.inventario_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE neura.inventario_ajustes_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE neura.inventario_traslados ENABLE ROW LEVEL SECURITY;
ALTER TABLE neura.inventario_traslados_items ENABLE ROW LEVEL SECURITY;

-- ─── 7. Poner en orden el stock por depósito de lo que ya existe ──────────────
-- Lo que el total tiene de más respecto de la suma de depósitos va al depósito
-- principal del producto o al predeterminado (sin pasar por el trigger).
INSERT INTO neura.inventario_stock_ubicacion (empresa_id, producto_id, ubicacion_id, stock_actual, es_principal)
SELECT p.empresa_id, p.id,
       COALESCE(p.ubicacion_principal_id, neura.inv_deposito_predeterminado(p.empresa_id)),
       COALESCE(p.stock_actual, 0) - COALESCE(s.suma, 0),
       NOT EXISTS (SELECT 1 FROM neura.inventario_stock_ubicacion z
                    WHERE z.empresa_id = p.empresa_id AND z.producto_id = p.id AND z.es_principal)
  FROM neura.productos p
  LEFT JOIN (SELECT producto_id, sum(stock_actual) AS suma
               FROM neura.inventario_stock_ubicacion GROUP BY producto_id) s ON s.producto_id = p.id
 WHERE COALESCE(p.stock_actual, 0) <> COALESCE(s.suma, 0)
ON CONFLICT (empresa_id, producto_id, ubicacion_id)
DO UPDATE SET stock_actual = neura.inventario_stock_ubicacion.stock_actual + EXCLUDED.stock_actual,
              updated_at = now();

COMMIT;

NOTIFY pgrst, 'reload schema';
