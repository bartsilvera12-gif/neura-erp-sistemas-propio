-- =============================================================================
-- Módulo Proyectos — Sub-etapa de desarrollo
--
-- Detalle fino del avance mientras el proyecto está "En desarrollo". Es un eje
-- acotado sobre `proyectos`, paralelo a `etapa_desarrollo` y `qa_etapa`:
--   subestado_desarrollo      código de la fase actual (ver src/lib/proyectos/
--                             subestados-desarrollo.ts) — NULL = sin definir
--   subestado_desarrollo_at   cuándo entró a la sub-etapa actual
--
-- El catálogo de sub-etapas vive en el código y depende del tipo de proyecto
-- (web vs saas/erp), así que NO se agrega un CHECK con la lista de códigos: eso
-- ataría la base a una lista que puede ajustarse sin migración. La validez
-- (código conocido + coincide con el tipo + sólo en estado 'desarrollo') la
-- gobierna la API. La columna es texto libre nullable.
--
-- Sólo agrega columnas nullable (sin default, sin backfill), por lo que no hace
-- falta tocar el trigger `set_updated_at` ni GRANTs (hereda los de la tabla).
--
-- Multi-schema: mismo patrón que 20260807120000_proyecto_etapa_desarrollo.sql.
-- =============================================================================

DO $$
DECLARE
  r    RECORD;
  sch  text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyectos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS subestado_desarrollo text',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS subestado_desarrollo_at timestamptz',
      sch
    );
  END LOOP;
END $$;
