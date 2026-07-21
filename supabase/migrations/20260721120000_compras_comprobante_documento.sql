-- =============================================================================
-- Compras: datos del comprobante (N° de factura, tipo) + adjunto del documento.
-- SOLO schema `neura`. Idempotente. No borra ni altera datos históricos:
-- todas las columnas son nullable (o con default no destructivo).
--
-- Aclaración fiscal:
--   nro_timbrado       = timbrado (8 dígitos) — ya existía.
--   numero_comprobante = N° de la factura del proveedor (001-001-0000001) — NUEVO.
--   tipo_comprobante   = 'Factura' por defecto.
--   documento_path     = ruta en Storage de la foto/PDF de la factura.
-- =============================================================================

BEGIN;

ALTER TABLE neura.compras
  ADD COLUMN IF NOT EXISTS numero_comprobante text,
  ADD COLUMN IF NOT EXISTS tipo_comprobante   text NOT NULL DEFAULT 'Factura',
  ADD COLUMN IF NOT EXISTS documento_path     text,
  ADD COLUMN IF NOT EXISTS documento_mime     text;

DO $$
DECLARE v_cols int;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='neura' AND table_name='compras'
     AND column_name IN ('numero_comprobante','tipo_comprobante','documento_path','documento_mime');
  RAISE NOTICE 'compras comprobante: columnas_nuevas=%', v_cols;
END $$;

COMMIT;
