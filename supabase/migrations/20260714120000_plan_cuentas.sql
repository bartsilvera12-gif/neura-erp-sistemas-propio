-- =============================================================================
-- Plan de Cuentas (catalogo contable) — SOLO schema `neura`. Idempotente y segura.
-- Referencias locales (neura.*). No toca datos existentes de otros modulos.
-- Aplicar: node scripts/apply-migration-file-pg.cjs <este archivo>  (o via SSH psql).
-- Estructura jerarquica auto-referenciada (cuenta_padre_id). Unico por (empresa_id, cuenta).
-- La cuenta padre de la carga inicial se resuelve por prefijo de codigo mas largo existente.
-- Toda la migracion corre en UNA transaccion (necesario para la TEMP TABLE ON COMMIT DROP).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS neura.plan_cuentas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  cuenta          text NOT NULL,
  denominacion    text NOT NULL,
  nivel           integer NOT NULL,
  naturaleza      text NOT NULL CHECK (naturaleza IN ('D','A')),
  asentable       boolean NOT NULL DEFAULT false,
  centro_costo    boolean NOT NULL DEFAULT false,
  moneda          text,
  tipo_cambio     text,
  cuenta_sset     text,
  cuenta_padre_id uuid REFERENCES neura.plan_cuentas(id) ON DELETE SET NULL,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_cuentas_cuenta_empresa_uk UNIQUE (empresa_id, cuenta),
  CONSTRAINT plan_cuentas_no_self_parent CHECK (cuenta_padre_id IS NULL OR cuenta_padre_id <> id)
);

CREATE INDEX IF NOT EXISTS ix_plan_cuentas_empresa       ON neura.plan_cuentas (empresa_id);
CREATE INDEX IF NOT EXISTS ix_plan_cuentas_padre         ON neura.plan_cuentas (empresa_id, cuenta_padre_id);
CREATE INDEX IF NOT EXISTS ix_plan_cuentas_nivel         ON neura.plan_cuentas (empresa_id, nivel);
CREATE INDEX IF NOT EXISTS ix_plan_cuentas_cuenta_lower  ON neura.plan_cuentas (empresa_id, lower(cuenta));
CREATE INDEX IF NOT EXISTS ix_plan_cuentas_denom_lower   ON neura.plan_cuentas (empresa_id, lower(denominacion));

ALTER TABLE neura.plan_cuentas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_cuentas_select ON neura.plan_cuentas;
CREATE POLICY plan_cuentas_select ON neura.plan_cuentas
  FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS plan_cuentas_insert ON neura.plan_cuentas;
CREATE POLICY plan_cuentas_insert ON neura.plan_cuentas
  FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS plan_cuentas_update ON neura.plan_cuentas;
CREATE POLICY plan_cuentas_update ON neura.plan_cuentas
  FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id))
  WITH CHECK (neura.puede_acceder_empresa(empresa_id));
DROP POLICY IF EXISTS plan_cuentas_delete ON neura.plan_cuentas;
CREATE POLICY plan_cuentas_delete ON neura.plan_cuentas
  FOR DELETE USING (neura.puede_acceder_empresa(empresa_id));

GRANT SELECT ON neura.plan_cuentas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.plan_cuentas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.plan_cuentas TO service_role;

DROP TRIGGER IF EXISTS tr_plan_cuentas_updated ON neura.plan_cuentas;
CREATE TRIGGER tr_plan_cuentas_updated BEFORE UPDATE ON neura.plan_cuentas
  FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();

-- ---------------------------------------------------------------------------
-- Carga inicial idempotente (228 cuentas). Se inserta para TODAS las empresas
-- del schema `neura` (cross join), sin hardcodear ids. ON CONFLICT evita duplicar.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _plan_cuentas_seed (
  cuenta        text,
  denominacion  text,
  nivel         integer,
  naturaleza    text,
  asentable     boolean,
  centro_costo  boolean,
  moneda        text,
  tipo_cambio   text,
  cuenta_sset   text,
  parent_code   text
) ON COMMIT DROP;

INSERT INTO _plan_cuentas_seed
  (cuenta, denominacion, nivel, naturaleza, asentable, centro_costo, moneda, tipo_cambio, cuenta_sset, parent_code)
VALUES
    ('1', 'ACTIVO', 1, 'D', false, false, 'Local', NULL, NULL, NULL),
    ('11', 'ACTIVO CORRIENTE', 2, 'D', false, false, 'Local', NULL, NULL, '1'),
    ('111', 'DISPONIBILIDADES', 3, 'D', false, false, 'Local', 'Comprador', NULL, '11'),
    ('1111', 'CAJAS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '111'),
    ('11111', 'Caja', 5, 'D', true, true, 'Local', NULL, '1 01 01 01', '1111'),
    ('11112', 'Caja Chica', 5, 'D', true, false, 'Local', 'Comprador', '1 01 01 01', '1111'),
    ('11113', 'Recaudaciones a Depositar', 5, 'D', true, false, 'Local', 'Comprador', '1 01 01 02', '1111'),
    ('11114', 'Caja Dólar', 5, 'D', true, true, 'DOLAR', 'Comprador', '1 01 01 01', '1111'),
    ('1112', 'BANCOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '111'),
    ('11121', 'Banco Continental Cta Cte', 5, 'D', true, true, 'Local', NULL, '1 01 01 03', '1112'),
    ('11122', 'Banco Sudameris Cta Cte. USD', 5, 'D', true, false, 'DOLAR', 'Comprador', '1 01 01 03', '1112'),
    ('112', 'CREDITOS', 3, 'D', false, false, 'Local', 'Comprador', NULL, '11'),
    ('1122', 'CUENTAS A COBRAR', 4, 'D', false, false, 'Local', 'Comprador', NULL, '112'),
    ('11221', 'CLIENTES M.L.', 5, 'D', false, true, 'Local', NULL, NULL, '1122'),
    ('1122101', 'Automoviles', 6, 'D', true, false, 'Local', NULL, NULL, '11221'),
    ('1122102', 'Carniceria La Albirró', 6, 'D', true, false, 'Local', NULL, '1 01 03 01', '11221'),
    ('1122103', 'Plásticos del Paraguay', 6, 'D', true, false, 'Local', NULL, NULL, '11221'),
    ('1122104', 'Starsoft S.R.L.', 6, 'D', true, false, 'Local', NULL, '1 01 03 01', '11221'),
    ('1122105', 'Diario 5 Días', 6, 'D', true, false, 'Local', NULL, '1 01 03 01', '11221'),
    ('1122106', 'Clientes Varios', 6, 'D', true, false, 'Local', NULL, '1 01 03 01', '11221'),
    ('11222', 'CLIENTES M.E.', 5, 'D', false, false, 'Local', NULL, NULL, '1122'),
    ('1122201', 'La Internacional S.A. USD', 6, 'D', true, false, 'DOLAR', 'Comprador', '1 01 03 01', '11222'),
    ('1122202', 'El Proveedor Abastecimientos S.A. USD', 6, 'D', true, false, 'DOLAR', 'Comprador', '1 01 03 01', '11222'),
    ('1122203', 'Clientes Varios', 6, 'D', true, false, 'DOLAR', 'Comprador', '1 01 03 01', '11222'),
    ('11223', 'Cuentas a Cobrar', 5, 'D', true, false, 'Local', NULL, '1 02 01 03', '1122'),
    ('11224', 'Deudores Morosos', 5, 'D', true, false, 'Local', NULL, '1 01 03 11', '1122'),
    ('11225', 'Deudores en Gestión de Cobro Judicial', 5, 'D', true, false, 'Local', NULL, '1 01 03 11', '1122'),
    ('1123', 'OTROS CREDITOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '112'),
    ('11231', 'Anticipo al Personal', 5, 'D', true, false, 'Local', 'Comprador', '1 01 03 11', '1123'),
    ('11232', 'Anticipo Gastos a Rendir', 5, 'D', true, false, 'Local', 'Comprador', '1 01 03 11', '1123'),
    ('11233', 'Anticipo Impuesto a la Renta', 5, 'D', true, false, 'Local', 'Comprador', '1 01 03 02', '1123'),
    ('11234', 'Retención Impuesto a la Renta', 5, 'D', true, false, 'Local', 'Comprador', '1 01 03 02', '1123'),
    ('11235', 'IVA Crédito 5%', 5, 'D', true, true, 'Local', NULL, '1 01 03 02', '1123'),
    ('11236', 'IVA Crédito 10 %', 5, 'D', true, true, 'Local', NULL, '1 01 03 02', '1123'),
    ('11237', 'Retención IVA', 5, 'D', true, false, 'Local', NULL, '1 01 03 04', '1123'),
    ('11238', 'Anticipo a Proveedores M.L.', 5, 'D', true, false, 'Local', NULL, '2 01 20 02', '1123'),
    ('11239', 'Anticipo a Proveedores M.E.', 5, 'D', true, false, 'DOLAR', 'Comprador', NULL, '1123'),
    ('113', 'BIENES DE CAMBIO', 3, 'D', false, false, 'Local', 'Comprador', NULL, '11'),
    ('1131', 'MERCADERIAS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '113'),
    ('11311', 'Mercaderías', 5, 'D', true, true, 'Local', NULL, '1 01 10 01', '1131'),
    ('11312', 'Mercaderías Exenta', 5, 'D', true, false, 'Local', NULL, '1 01 10 01', '1131'),
    ('12', 'ACTIVO NO CORRIENTE', 2, 'D', false, false, 'Local', 'Comprador', NULL, '1'),
    ('121', 'BIENES DE USO', 3, 'D', false, false, 'Local', 'Comprador', NULL, '12'),
    ('1211', 'MUEBLES Y UTILES', 4, 'D', false, false, 'Local', 'Comprador', NULL, '121'),
    ('12111', 'a.1) Muebles y Útiles', 5, 'D', true, false, 'Local', NULL, '1 02 10 01', '1211'),
    ('12112', 'a.2) Útiles y Enseres', 5, 'D', true, false, 'Local', NULL, '1 02 10 01', '1211'),
    ('12113', '#¿NOMBRE?', 5, 'D', true, false, 'Local', NULL, '1 02 10 02', '1211'),
    ('1212', 'MAQUINARIAS, HERRAMIENTAS Y EQUIPOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '121'),
    ('12121', 'b.1) Maquinarias', 5, 'D', true, false, 'Local', NULL, '1 02 10 01', '1212'),
    ('12122', 'b.2) Herramientas y Equipos', 5, 'D', true, false, 'Local', 'Comprador', '1 02 10 01', '1212'),
    ('12123', 'b.3) Equipos de Informática', 5, 'D', true, false, 'Local', NULL, '1 02 10 01', '1212'),
    ('12124', '#¿NOMBRE?', 5, 'D', true, false, 'Local', NULL, '1 02 10 02', '1212'),
    ('1213', 'TRANSPORTE TERRESTRE', 4, 'D', false, false, 'Local', 'Comprador', NULL, '121'),
    ('12131', 'c.1) Automóviles', 5, 'D', true, false, 'Local', NULL, '1 02 10 01', '1213'),
    ('12132', 'c.2) Motocicletas', 5, 'D', true, false, 'Local', 'Comprador', '1 02 10 01', '1213'),
    ('12133', 'c.3) Restantes Bienes', 5, 'D', true, false, 'Local', 'Comprador', '1 02 10 01', '1213'),
    ('12134', '#¿NOMBRE?', 5, 'D', true, false, 'Local', NULL, '1 02 10 02', '1213'),
    ('1214', 'TRANSPORTE AEREO', 4, 'D', false, false, 'Local', 'Comprador', NULL, '121'),
    ('12141', 'd.1) Aviones, Avionetas', 5, 'D', true, false, 'Local', 'Comprador', '1 02 10 01', '1214'),
    ('12142', 'd.2) Instalaciones de Tierra', 5, 'D', true, false, 'Local', 'Comprador', '1 02 10 01', '1214'),
    ('12143', '#¿NOMBRE?', 5, 'D', true, false, 'Local', NULL, '1 02 10 02', '1214'),
    ('1215', 'TRANSPORTE MARITIMO Y FLUVIAL', 4, 'D', false, false, 'Local', 'Comprador', NULL, '121'),
    ('1216', 'TRANSPORTE FERROVIARIO', 4, 'D', false, false, 'Local', 'Comprador', NULL, '121'),
    ('1217', 'INMUEBLES', 4, 'D', false, false, 'Local', 'Comprador', NULL, '121'),
    ('12171', 'g.1) Edificios', 5, 'D', true, false, 'Local', 'Comprador', '1 02 10 01', '1217'),
    ('12172', 'g.2) Mejoras en Prop. Ajena', 5, 'D', true, false, 'Local', 'Comprador', '1 02 10 01', '1217'),
    ('12173', 'g.3) Terreno', 5, 'D', true, false, 'Local', 'Comprador', '1 02 10 01', '1217'),
    ('12174', '#¿NOMBRE?', 5, 'D', true, false, 'Local', NULL, '1 02 10 01', '1217'),
    ('1218', 'RESTANTES BIENES NO CONTEMPLADO', 4, 'D', false, false, 'Local', 'Comprador', NULL, '121'),
    ('122', 'CARGOS DIFERIDOS', 3, 'D', false, false, 'Local', 'Comprador', NULL, '12'),
    ('1221', 'GASTOS DIFERIDOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '122'),
    ('12211', 'Gastos de Constitución y Organización', 5, 'D', true, false, 'Local', NULL, '1 02 20 03', '1221'),
    ('12212', 'Gastos de Proyectos de Inversión', 5, 'D', true, false, 'Local', NULL, '1 02 20 03', '1221'),
    ('12213', 'Gastos de Desarrollo e Inversión', 5, 'D', true, false, 'Local', NULL, '1 02 20 03', '1221'),
    ('12214', '#¿NOMBRE?', 5, 'D', true, false, 'Local', NULL, '1 02 20 04', '1221'),
    ('1222', 'OTROS DIFERIDOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '122'),
    ('12221', 'Alquiler a Vencer', 5, 'D', true, false, 'Local', 'Comprador', '1 02 20 05', '1222'),
    ('12222', 'Seguros a Vencer', 5, 'D', true, false, 'Local', 'Comprador', '2 01 10 06', '1222'),
    ('12223', 'Intereses y Comisiones a Vencer', 5, 'D', true, false, 'Local', 'Comprador', '1 01 03 13', '1222'),
    ('12462', 'SAN CRISTOBAL CAJA DE AHORRO', 5, 'D', true, false, 'Local', NULL, NULL, '12'),
    ('15451', 'Mantenimiento de maquinas', 5, 'D', true, false, 'Local', NULL, NULL, '1'),
    ('2', 'PASIVO', 1, 'A', false, false, 'Local', 'Comprador', NULL, NULL),
    ('21', 'PASIVO CORRIENTE', 2, 'A', false, false, 'Local', 'Comprador', NULL, '2'),
    ('211', 'DEUDAS', 3, 'A', false, false, 'Local', 'Comprador', NULL, '21'),
    ('2111', 'DEUDAS COMERCIALES', 4, 'A', false, false, 'Local', 'Comprador', NULL, '211'),
    ('21111', 'PROVEEDORES LOCALES', 5, 'A', false, true, 'Local', NULL, NULL, '2111'),
    ('2111101', 'Vidrios EL Quebrado S.A.', 6, 'A', true, false, 'Local', NULL, '2 01 01 01', '21111'),
    ('2111102', 'Super El Pais', 6, 'A', true, false, 'Local', NULL, '2 01 01 01', '21111'),
    ('2111103', 'El Proveedor S.A.', 6, 'A', true, false, 'Local', NULL, '2 01 01 01', '21111'),
    ('2111104', 'Atlantic S.A.E.C.A', 6, 'A', true, false, 'Local', NULL, '2 01 01 01', '21111'),
    ('2111105', 'Proveedores Varios', 6, 'A', true, false, 'Local', NULL, '2 01 01 01', '21111'),
    ('21112', 'PROVEEDORES DEL EXTERIOR', 5, 'A', false, false, 'Local', NULL, NULL, '2111'),
    ('2111201', 'El Importador S.A.', 6, 'A', true, false, 'DOLAR', 'Vendedor', '2 01 01 02', '21112'),
    ('2111202', 'FinImport S.R.L.', 6, 'A', true, false, 'DOLAR', 'Vendedor', '2 01 01 02', '21112'),
    ('211123', 'Proveedores Externos Varios', 6, 'A', true, false, 'DOLAR', 'Vendedor', '2 01 01 01', '21112'),
    ('21113', 'Letras a Pagar', 5, 'A', true, false, 'Local', 'Comprador', NULL, '2111'),
    ('2112', 'DEUDAS FINANCIERAS', 4, 'A', false, false, 'Local', NULL, NULL, '211'),
    ('21121', 'Prestamos Bancarios', 5, 'A', true, false, 'Local', NULL, '2 02 01 01', '2112'),
    ('21122', 'Sobregiros en Cta. Cte.', 5, 'A', true, false, 'Local', NULL, '2 01 05 01', '2112'),
    ('2113', 'DEUDAS FISCALES Y SOCIALES', 4, 'A', false, false, 'Local', NULL, NULL, '211'),
    ('21131', 'IVA Débito 5%', 5, 'A', true, true, 'Local', NULL, '2 01 10 02', '2113'),
    ('21132', 'IVA Débito 10%', 5, 'A', true, true, 'Local', NULL, '2 01 10 02', '2113'),
    ('21133', 'Dción. Gral. de Recaudación', 5, 'A', true, false, 'Local', NULL, '2 01 10 01', '2113'),
    ('21134', 'Instituto de Prevision Social', 5, 'A', true, false, 'Local', NULL, '2 01 10 05', '2113'),
    ('21135', 'Retención del IVA', 5, 'A', true, true, 'Local', NULL, '2 01 10 03', '2113'),
    ('21136', 'Retención de Imp. a la Renta', 5, 'A', true, true, 'Local', NULL, '2 01 10 03', '2113'),
    ('2114', 'OTRAS DEUDAS', 4, 'A', false, false, 'Local', NULL, NULL, '211'),
    ('21141', 'Sueldo y Remuneraciones a Pagar', 5, 'A', true, false, 'Local', NULL, '2 01 01 04', '2114'),
    ('21142', 'Honorarios a Pagar', 5, 'A', true, false, 'Local', NULL, '2 01 01 04', '2114'),
    ('21143', 'Cuentas a Pagar', 5, 'A', true, false, 'Local', NULL, '2 01 01 04', '2114'),
    ('21144', 'Acreedores Varios', 5, 'A', true, false, 'Local', NULL, '2 01 01 04', '2114'),
    ('22', 'PASIVOS NO CORRIENTE', 2, 'A', false, false, 'Local', 'Comprador', NULL, '2'),
    ('221', 'PROVISIONES', 3, 'A', false, false, 'Local', 'Comprador', NULL, '22'),
    ('2211', 'PROVISION Y PREVISION', 4, 'A', false, false, 'Local', 'Comprador', NULL, '221'),
    ('22111', 'Provisión para Despido', 5, 'A', true, false, 'Local', NULL, '2 02 05 01', '2211'),
    ('22112', 'Provisión para Diferencia de Cambios', 5, 'A', true, false, 'Local', NULL, '2 02 05 02', '2211'),
    ('222', 'UTILIDADES DIFERIDAS', 3, 'A', false, false, 'Local', 'Comprador', NULL, '22'),
    ('2221', 'UTILIDADES DIFERIDAS S/ VENTAS', 4, 'A', false, false, 'Local', 'Comprador', NULL, '222'),
    ('22211', 'Utilidades Diferidas s/ Ventas a Plazo', 5, 'A', true, false, 'Local', 'Comprador', '1 01 20 01', '2221'),
    ('22212', 'Intereses Cobrado por Adelantado', 5, 'A', true, false, 'Local', 'Comprador', '2 01 01 03', '2221'),
    ('22213', 'Rentas Anticipados', 5, 'A', true, false, 'Local', 'Comprador', '1 01 03 03', '2221'),
    ('3', 'PATRIMONIO NETO', 1, 'A', false, false, 'Local', 'Comprador', NULL, NULL),
    ('33', 'CAPITAL RESERVAS Y RESULTADOS', 2, 'A', false, false, 'Local', 'Comprador', NULL, '3'),
    ('331', 'CAPITAL SOCIAL', 3, 'A', false, false, 'Local', 'Comprador', NULL, '33'),
    ('3311', 'Capital Integrado', 4, 'A', true, false, 'Local', 'Comprador', '2 03 01 02', '331'),
    ('3312', 'Capital Suscripto', 4, 'A', true, false, 'Local', 'Comprador', '2 03 01 01', '331'),
    ('332', 'RESERVAS', 3, 'A', false, false, 'Local', 'Comprador', NULL, '33'),
    ('3321', 'Reserva de Revalúo', 4, 'A', true, false, 'Local', NULL, '2 03 02 03', '332'),
    ('3322', 'Reserva Legal', 4, 'A', true, false, 'Local', 'Comprador', '2 03 02 01', '332'),
    ('3323', 'Reserva Facultativa', 4, 'A', true, false, 'Local', 'Comprador', '2 03 02 02', '332'),
    ('333', 'RESULTADOS', 3, 'A', false, false, 'Local', 'Comprador', NULL, '33'),
    ('3331', 'Resultados Acumulados', 4, 'A', true, false, 'Local', 'Comprador', '2 03 03 01', '333'),
    ('3332', 'Resultado del Ejercicio', 4, 'A', true, false, 'Local', 'Comprador', '2 03 03 02', '333'),
    ('4', 'INGRESOS', 1, 'A', false, false, 'Local', 'Comprador', NULL, NULL),
    ('41', 'INGRESOS OPERATIVOS', 2, 'A', false, false, 'Local', 'Comprador', NULL, '4'),
    ('411', 'VENTAS DE MERCADERIAS Y SERVICIOS', 3, 'A', false, false, 'Local', 'Comprador', NULL, '41'),
    ('4111', 'VENTAS DE MERCADERIAS', 4, 'A', false, false, 'Local', 'Comprador', NULL, '411'),
    ('41111', 'Ventas de Merc. Gravadas', 5, 'A', true, true, 'Local', NULL, '3 02 01', '4111'),
    ('41112', 'Ventas de Servicios', 5, 'A', true, true, 'Local', 'Comprador', '3 02 01', '4111'),
    ('41113', 'Ventas de Merc. Exentas', 5, 'A', true, true, 'Local', NULL, '3 02 01', '4111'),
    ('412', 'OTROS INGRESOS', 3, 'A', false, false, 'Local', 'Comprador', NULL, '41'),
    ('41211', 'Descuentos Obtenidos', 5, 'A', true, false, 'Local', NULL, '3 10 02', '412'),
    ('41212', 'Alquileres Cobrados', 5, 'A', true, false, 'Local', NULL, '3 10 02', '412'),
    ('41213', 'Intereses Cobrados', 5, 'A', true, false, 'Local', NULL, '3 10 01', '412'),
    ('41214', 'Ingresos Varios', 5, 'A', true, false, 'Local', NULL, '3 10 02', '412'),
    ('41215', 'Diferencia de Cambio', 5, 'A', true, false, 'Local', NULL, '3 10 02', '412'),
    ('5', 'EGRESOS', 1, 'D', false, false, 'Local', 'Comprador', NULL, NULL),
    ('500014', 'Gastos Generales', 5, 'D', true, false, 'Local', NULL, NULL, '5'),
    ('500021', 'Elementos de Limpieza', 5, 'D', true, false, 'Local', NULL, NULL, '5'),
    ('50014', 'Botiquin', 5, 'D', true, false, 'Local', NULL, NULL, '5'),
    ('51', 'EGRESOS OPERATIVOS', 2, 'D', false, false, 'Local', 'Comprador', NULL, '5'),
    ('511', 'GASTOS DE COMERCIALIZACION', 3, 'D', false, false, 'Local', 'Comprador', NULL, '51'),
    ('5111', 'GASTOS DE VENTAS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '511'),
    ('51111', 'Comisiones Pagadas', 5, 'D', true, false, 'Local', 'Comprador', '4 12', '5111'),
    ('51112', 'Publicidad y Propaganda', 5, 'D', true, false, 'Local', 'Comprador', '4 12', '5111'),
    ('51113', 'Fletes y/o Movilidad Pagadas', 5, 'D', true, false, 'Local', 'Comprador', '4 12', '5111'),
    ('51114', 'Seguros sobre Mercaderias', 5, 'D', true, false, 'Local', 'Comprador', '4 12', '5111'),
    ('51115', 'Descuentos Concedidos', 5, 'D', true, false, 'Local', 'Comprador', '4 12', '5111'),
    ('51116', 'Gastos de Representación', 5, 'D', true, false, 'Local', NULL, '4 12', '5111'),
    ('51117', 'Diferencia de Cambio', 5, 'D', true, false, 'Local', 'Comprador', '4 12', '5111'),
    ('51125', 'Honorario Profesionales', 5, 'D', true, false, 'Local', NULL, NULL, '511'),
    ('51126', 'Servicios', 5, 'D', true, false, 'Local', NULL, NULL, '511'),
    ('51127', 'Insumos y Materiales', 5, 'D', true, false, 'Local', NULL, NULL, '511'),
    ('512', 'GASTOS FINANCIEROS', 3, 'D', false, false, 'Local', 'Comprador', NULL, '51'),
    ('5121', 'GASTOS BANCARIOS Y NO BANCARIOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '512'),
    ('51211', 'Interés, Comisión Gtos. Bancarios', 5, 'D', true, false, 'Local', NULL, '3 20 01', '5121'),
    ('51212', 'Otros Intereses', 5, 'D', true, false, 'Local', 'Comprador', '3 20 01', '5121'),
    ('51245', 'Insumos Informaticos', 5, 'D', true, false, 'Local', NULL, NULL, '512'),
    ('513', 'GASTOS ADMINISTRATIVOS', 3, 'D', false, false, 'Local', 'Comprador', NULL, '51'),
    ('5131', 'SUELDOS Y CARGAS SOCIALES', 4, 'D', false, false, 'Local', 'Comprador', NULL, '513'),
    ('51311', 'Sueldos y Jornales', 5, 'D', true, false, 'Local', 'Comprador', '4 14', '5131'),
    ('51312', 'Bonificación Familiar', 5, 'D', true, false, 'Local', NULL, '4 13', '5131'),
    ('51313', 'Aguinaldos', 5, 'D', true, false, 'Local', 'Comprador', '4 14', '5131'),
    ('51314', 'Vacaciones e Indemnizaciones', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5131'),
    ('51315', 'Aporte Patronal IPS', 5, 'D', true, false, 'Local', 'Comprador', '4 14', '5131'),
    ('51316', 'Remuneración Personal Superior', 5, 'D', true, false, 'Local', NULL, '4 13', '5131'),
    ('5132', 'HONORARIOS PROFESIONALES', 4, 'D', false, false, 'Local', 'Comprador', NULL, '513'),
    ('51321', 'Honorarios por Servicios Contables', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5132'),
    ('51322', 'Honorarios por Asesoramiento Impositivo', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5132'),
    ('51323', 'Honorarios por Auditoría Externa', 5, 'D', true, false, 'Local', NULL, '4 13', '5132'),
    ('5133', 'IMPRESOS Y UTILES', 4, 'D', false, false, 'Local', 'Comprador', NULL, '513'),
    ('51331', 'Impresos y Útiles', 5, 'D', true, false, 'Local', NULL, '4 13', '5133'),
    ('51332', 'Gastos de Insumos Informáticos', 5, 'D', true, false, 'Local', NULL, '4 13', '5133'),
    ('5134', 'ALQUILERES PAGADOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '513'),
    ('51341', 'Alquileres Pagados por Inmuebles', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5134'),
    ('51342', 'Otros', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5134'),
    ('5135', 'SERVICIOS BASICOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '513'),
    ('51351', 'Luz, Agua y Teléfono', 5, 'D', true, false, 'Local', NULL, '4 13', '5135'),
    ('5136', 'REPARACION Y MANTENIMIENTO', 4, 'D', false, false, 'Local', 'Comprador', NULL, '513'),
    ('51361', 'Rep. y Mant. de Bienes de Uso', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5136'),
    ('51362', 'Rep. y Mant. de Edificios', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5136'),
    ('5137', 'GASTOS DE MOVILIDAD', 4, 'D', false, false, 'Local', 'Comprador', NULL, '513'),
    ('51371', 'Combustibles y Lubricantes', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5137'),
    ('51372', 'Rep. y Mant. de Rodados', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5137'),
    ('51373', 'Pasajes y Viáticos', 5, 'D', true, false, 'Local', NULL, '4 13', '5137'),
    ('5138', 'IMPUESTOS, PATENTES Y TASAS', 4, 'D', false, false, 'Local', NULL, NULL, '513'),
    ('51381', 'Patentes e Impuestos', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5138'),
    ('51382', 'Otros Impuestos', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5138'),
    ('5139', 'GASTOS VARIOS', 4, 'D', false, false, 'Local', 'Comprador', NULL, '513'),
    ('51391', 'Donaciones y Contribución', 5, 'D', true, false, 'Local', NULL, '4 13', '5139'),
    ('51392', 'Seguros', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5139'),
    ('51393', 'Gastos Generales', 5, 'D', true, true, 'Local', 'Comprador', '4 13', '5139'),
    ('51394', 'Diferencia de Cálculo del IVA', 5, 'D', true, false, 'Local', NULL, '4 13', '5139'),
    ('51395', 'OTROS GASTOS', 1, 'A', true, false, 'Local', NULL, NULL, '5139'),
    ('514', 'GASTOS NO DED. AMORTIZ, DEPRECIACIONES', 3, 'D', false, false, 'Local', 'Comprador', NULL, '51'),
    ('5141', 'GASTOS NO DEDUCIBLES', 4, 'D', false, false, 'Local', 'Comprador', NULL, '514'),
    ('51411', 'Recargos y Multas', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5141'),
    ('51412', 'Reserva Legal', 5, 'D', true, false, 'Local', 'Comprador', '4 13', '5141'),
    ('51413', 'Impuesto a la Renta Ley 125/91', 5, 'D', true, false, 'Local', 'Comprador', '5 50', '5141'),
    ('5142', 'AMORTIZACIONES', 4, 'D', false, false, 'Local', 'Comprador', NULL, '514'),
    ('51421', 'Amortiz. B.P. Gtos Deducibles', 5, 'D', true, false, 'Local', 'Comprador', NULL, '5142'),
    ('5143', 'DEPRECIACIONES', 4, 'D', false, false, 'Local', 'Comprador', NULL, '514'),
    ('51431', 'Depreciación del Ejercicio', 5, 'D', true, false, 'Local', NULL, '1 02 10 02', '5143'),
    ('51432', 'Depreciación del Ejercicio GND', 5, 'D', true, false, 'Local', NULL, '1 02 10 02', '5143'),
    ('515', 'COSTO DE MERCADERIAS VENDIDAS', 3, 'D', false, false, 'Local', NULL, NULL, '51'),
    ('5151', 'Costo de Merc. Grav.', 4, 'D', true, false, 'Local', NULL, '4 01', '515'),
    ('51518', 'Viaticos', 5, 'D', true, false, 'Local', NULL, NULL, '5151'),
    ('5152', 'Costo de Merc. Exentas', 4, 'D', true, false, 'Local', NULL, '4 01', '515'),
    ('5153', 'IVA Costo', 4, 'D', true, false, 'Local', NULL, '4 01', '515'),
    ('5158', 'Capacitacion', 5, 'D', true, false, 'Local', NULL, NULL, '515'),
    ('5159', 'Uniforme', 5, 'D', true, false, 'Local', NULL, NULL, '515'),
    ('516', 'RESULTADO DEL EJERCICIO', 3, 'D', false, false, 'Local', NULL, NULL, '51'),
    ('5161', 'PERDIDAS Y GANANCIAS', 4, 'D', false, false, 'Local', NULL, NULL, '516'),
    ('51611', 'Resultado a la Fecha', 5, 'D', true, false, 'Local', NULL, '4 13', '5161'),
    ('52115', 'Agua, Luz y Telefono', 5, 'D', true, false, 'Local', NULL, NULL, '5'),
    ('54589', 'IMPUESTOS TASAS Y PATENTES', 5, 'D', true, false, 'Local', NULL, NULL, '5'),
    ('5511', 'Mantenimiento de Rodados', 5, 'D', true, false, 'Local', NULL, NULL, '5'),
    ('56565', 'Utiles de Oficina', 5, 'D', true, false, 'Local', NULL, NULL, '5');

-- Insertar cuentas (sin padre todavia) para cada empresa.
INSERT INTO neura.plan_cuentas
  (empresa_id, cuenta, denominacion, nivel, naturaleza, asentable, centro_costo, moneda, tipo_cambio, cuenta_sset)
SELECT e.id, s.cuenta, s.denominacion, s.nivel, s.naturaleza, s.asentable, s.centro_costo, s.moneda, s.tipo_cambio, s.cuenta_sset
FROM neura.empresas e
CROSS JOIN _plan_cuentas_seed s
ON CONFLICT (empresa_id, cuenta) DO NOTHING;

-- Resolver cuenta padre por codigo, por empresa. Solo enlaza cuando aun no hay padre
-- (no pisa vinculos ajustados manualmente en corridas posteriores).
UPDATE neura.plan_cuentas c
SET cuenta_padre_id = p.id
FROM _plan_cuentas_seed s
JOIN neura.plan_cuentas p ON p.cuenta = s.parent_code
WHERE c.cuenta = s.cuenta
  AND p.empresa_id = c.empresa_id
  AND s.parent_code IS NOT NULL
  AND c.cuenta_padre_id IS NULL;

-- Reporte de verificacion (visible en logs de psql).
DO $$
DECLARE
  v_total  integer;
  v_root   integer;
  v_orphan integer;
BEGIN
  SELECT count(*) INTO v_total  FROM neura.plan_cuentas;
  SELECT count(*) INTO v_root   FROM neura.plan_cuentas WHERE cuenta_padre_id IS NULL;
  SELECT count(*) INTO v_orphan FROM neura.plan_cuentas WHERE cuenta_padre_id IS NULL AND nivel <> 1;
  RAISE NOTICE 'plan_cuentas: total=% raiz(sin_padre)=% orphan(sin_padre_y_nivel<>1)=%', v_total, v_root, v_orphan;
END $$;

COMMIT;
