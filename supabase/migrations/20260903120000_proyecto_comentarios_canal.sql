-- =============================================================================
-- Módulo Proyectos — Canal de comentarios (comercial ↔ PM · desarrollo ↔ PM/QA)
--
-- Los comentarios internos del proyecto pasan a tener dos canales separados:
--   'comercial'   -> comunicación comercial/vendedor ↔ Project Manager
--   'desarrollo'  -> comunicación desarrollador/técnico ↔ PM + QA
--
-- Visibilidad (se gobierna en la API, no en RLS ni en la UI):
--   comercial      -> ve sólo 'comercial'
--   técnico        -> ve sólo 'desarrollo'
--   PM, QA, admin  -> ven ambos
-- (ver src/lib/proyectos/comentarios-permisos.ts)
--
-- Los comentarios que ya existían no tenían canal: el DEFAULT 'comercial' del
-- ADD COLUMN los backfillea a 'comercial' (la mayoría son notas comercial/PM;
-- PM/QA/admin igual los siguen viendo).
--
-- Sólo agrega una columna con default + un CHECK, sin backfill manual, así que
-- no hace falta tocar triggers ni GRANTs (hereda los de la tabla).
--
-- Multi-schema idempotente: mismo patrón que las demás migraciones del módulo.
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
    WHERE c.relname = 'proyecto_comentarios'
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
      'ALTER TABLE %I.proyecto_comentarios
         ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT ''comercial''',
      sch
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'chk_proyecto_comentarios_canal'
        AND conrelid = format('%I.proyecto_comentarios', sch)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.proyecto_comentarios
           ADD CONSTRAINT chk_proyecto_comentarios_canal
           CHECK (canal IN (''comercial'', ''desarrollo''))',
        sch
      );
    END IF;
  END LOOP;
END $$;
