-- =============================================================================
-- Correctiva Plan de Cuentas + Compras. SOLO schema `neura`. Idempotente y segura.
-- 1) Agrega compras.cuenta_contable_id (nullable) → FK a plan_cuentas(id) + índice.
-- 2) Elimina de plan_cuentas 17 registros de TERCEROS (clientes/proveedores particulares)
--    que no deben vivir en el catálogo contable — solo si NO están referenciados.
-- 3) Renombra 3 cuentas bancarias particulares a denominaciones genéricas — solo si
--    conservan su nombre original del seed y no están referenciadas.
-- NO toca proveedores reales, NO toca proveedor_id de compras, NO toca otros schemas.
-- No edita ninguna migración ya aplicada.
-- =============================================================================

BEGIN;

-- 1) Compras: cuenta contable asociada (separada del proveedor). Nullable para
--    compatibilidad con compras históricas. ON DELETE SET NULL: si una cuenta se
--    borra en el futuro, la compra no se rompe.
ALTER TABLE neura.compras
  ADD COLUMN IF NOT EXISTS cuenta_contable_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'neura' AND constraint_name = 'compras_cuenta_contable_id_fkey'
  ) THEN
    ALTER TABLE neura.compras
      ADD CONSTRAINT compras_cuenta_contable_id_fkey
      FOREIGN KEY (cuenta_contable_id) REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_compras_cuenta_contable
  ON neura.compras (empresa_id, cuenta_contable_id);

-- 2) Eliminar los 17 terceros del catálogo (solo si no están referenciados por compras).
DELETE FROM neura.plan_cuentas p
WHERE p.cuenta IN (
    '1122101','1122102','1122103','1122104','1122105','1122106',
    '1122201','1122202','1122203',
    '2111101','2111102','2111103','2111104','2111105',
    '2111201','2111202','211123'
  )
  AND NOT EXISTS (SELECT 1 FROM neura.compras c WHERE c.cuenta_contable_id = p.id);

-- 3) Renombrar cuentas bancarias particulares a genéricas (solo si conservan el
--    nombre original del seed y no están referenciadas por compras).
DO $$
BEGIN
  -- 11121 → Banco Cuenta Corriente M.L.
  UPDATE neura.plan_cuentas p
     SET denominacion = 'Banco Cuenta Corriente M.L.'
   WHERE p.cuenta = '11121'
     AND p.denominacion = 'Banco Continental Cta Cte'
     AND NOT EXISTS (SELECT 1 FROM neura.compras c WHERE c.cuenta_contable_id = p.id);

  -- 11122 → Banco Cuenta Corriente M.E.
  UPDATE neura.plan_cuentas p
     SET denominacion = 'Banco Cuenta Corriente M.E.'
   WHERE p.cuenta = '11122'
     AND p.denominacion = 'Banco Sudameris Cta Cte. USD'
     AND NOT EXISTS (SELECT 1 FROM neura.compras c WHERE c.cuenta_contable_id = p.id);

  -- 12462 → Caja de Ahorro
  UPDATE neura.plan_cuentas p
     SET denominacion = 'Caja de Ahorro'
   WHERE p.cuenta = '12462'
     AND p.denominacion = 'SAN CRISTOBAL CAJA DE AHORRO'
     AND NOT EXISTS (SELECT 1 FROM neura.compras c WHERE c.cuenta_contable_id = p.id);
END $$;

-- Reporte de verificación.
DO $$
DECLARE
  v_total   integer;
  v_terceros integer;
  v_agrup   integer;
BEGIN
  SELECT count(*) INTO v_total FROM neura.plan_cuentas;
  SELECT count(*) INTO v_terceros FROM neura.plan_cuentas
    WHERE cuenta IN ('1122101','1122102','1122103','1122104','1122105','1122106',
                     '1122201','1122202','1122203','2111101','2111102','2111103',
                     '2111104','2111105','2111201','2111202','211123');
  SELECT count(*) INTO v_agrup FROM neura.plan_cuentas
    WHERE cuenta IN ('11221','11222','21111','21112') AND asentable = false;
  RAISE NOTICE 'plan_cuentas: total=% terceros_restantes=% agrupadoras_ok=%', v_total, v_terceros, v_agrup;
END $$;

COMMIT;
