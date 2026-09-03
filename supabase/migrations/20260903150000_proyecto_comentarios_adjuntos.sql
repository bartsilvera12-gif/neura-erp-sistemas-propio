-- =============================================================================
-- Módulo Proyectos — Adjuntos (imágenes) en comentarios
--
-- Los comentarios pueden llevar imágenes. Se guardan en el bucket privado
-- `proyectos` bajo `${empresaId}/${proyectoId}/comentarios/…` y se referencian
-- en la columna `adjuntos` (jsonb): un array de
--   { path, nombre, mime_type, size_bytes }
-- La vista previa / descarga se sirve con signed URLs de corta duración.
--
-- Sólo agrega una columna nullable, sin backfill: no toca triggers ni GRANTs.
-- Multi-schema idempotente.
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
      'ALTER TABLE %I.proyecto_comentarios ADD COLUMN IF NOT EXISTS adjuntos jsonb',
      sch
    );
  END LOOP;
END $$;
