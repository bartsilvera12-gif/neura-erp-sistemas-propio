-- =============================================================================
-- Activar el estado "Cancelado"
--
-- Ya existía en el catálogo, y bien configurado: `es_estado_final` en true,
-- `cuenta_sla` en false y `sort_order` 130 — justo después de Entregado (120),
-- al final del tablero. Lo único que le faltaba era estar activo.
--
-- No hace falta tocar código: el dashboard ya considera cancelado a cualquier
-- estado final que no sea Entregado (`esFinal && estadoId <> idEntregado`), y
-- un proyecto cancelado ya queda fuera de los KPI y del SLA.
--
-- Si en algún esquema no existiera, se crea al final de la fila. Sólo en los
-- que ya tengan "publicado": ahí hay un flujo de proyectos de verdad, y no se
-- le inventa un estado a un tenant que no usa el módulo.
-- =============================================================================

DO $$
DECLARE
  r    RECORD;
  sch  text;
  emp  RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_estados' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;

    -- Activar el que ya está.
    EXECUTE format(
      'UPDATE %I.proyecto_estados
          SET activo = true,
              es_estado_final = true,
              cuenta_sla = false,
              updated_at = now()
        WHERE codigo = ''cancelado'' AND activo IS DISTINCT FROM true',
      sch);

    -- Y crearlo donde falte, siempre que esa empresa ya tenga "publicado".
    FOR emp IN
      EXECUTE format(
        'SELECT DISTINCT empresa_id FROM %I.proyecto_estados WHERE codigo = ''publicado''', sch)
    LOOP
      EXECUTE format(
        'INSERT INTO %I.proyecto_estados
           (empresa_id, nombre, codigo, descripcion, color, sort_order,
            cuenta_sla, tipo_sla, es_estado_inicial, es_estado_final, activo)
         SELECT $1, ''Cancelado'', ''cancelado'',
                ''El proyecto no continúa. Sale de los KPI y deja de contar SLA.'',
                ''#475569'',
                COALESCE((SELECT MAX(sort_order) FROM %I.proyecto_estados WHERE empresa_id = $1), 100) + 10,
                false, ''final'', false, true, true
          WHERE NOT EXISTS (
            SELECT 1 FROM %I.proyecto_estados WHERE empresa_id = $1 AND codigo = ''cancelado'')',
        sch, sch, sch)
      USING emp.empresa_id;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
