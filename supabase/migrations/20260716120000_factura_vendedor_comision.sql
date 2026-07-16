-- =============================================================================
-- Vendedor por factura para comisión (Facturar venta desde Gestión de Clientes)
-- =============================================================================
-- Hasta ahora la comisión de una factura se atribuía SOLO por el vendedor del
-- cliente (clientes.vendedor_usuario_id). Este campo permite fijar el vendedor
-- que se lleva la comisión a nivel de FACTURA (elegido al emitir una venta al
-- contado marcada como comisionable). El preview de comisiones lo prefiere sobre
-- el vendedor del cliente cuando está presente.
-- =============================================================================

DO $migration$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'facturas' AND c.relkind = 'r'
      -- Alcance: solo el tenant `neura` (single_client).
      AND n.nspname IN ('neura')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.facturas ADD COLUMN IF NOT EXISTS vendedor_usuario_id uuid',
      sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_facturas_vendedor_usuario
         ON %I.facturas(empresa_id, vendedor_usuario_id)
         WHERE vendedor_usuario_id IS NOT NULL',
      sch
    );
    EXECUTE format(
      $c$ COMMENT ON COLUMN %I.facturas.vendedor_usuario_id IS
        'Vendedor que se lleva la comisión de esta factura (override por factura sobre clientes.vendedor_usuario_id). Se setea al emitir una venta comisionable.' $c$,
      sch
    );
  END LOOP;
END
$migration$;
