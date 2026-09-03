-- =============================================================================
-- Módulo Proyectos — Reenvío de comentarios entre canales
--
-- PM/QA/Admin pueden reenviar un comentario al OTRO canal, con una nota opcional
-- arriba. El reenvío conserva el original "tal cual": autor, texto y fecha del
-- comentario original quedan como snapshot en la columna `reenvio` (jsonb):
--   { comentario_id, autor_id, autor_nombre, texto, fecha, canal_origen }
-- El `comentario` de la fila guarda la nota del que reenvía (puede ser vacío),
-- `usuario_id` es quien reenvía, `canal` es el canal destino.
--
-- Sólo agrega una columna nullable, sin backfill, así que no toca triggers ni
-- GRANTs (hereda los de la tabla). Multi-schema idempotente.
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
      'ALTER TABLE %I.proyecto_comentarios ADD COLUMN IF NOT EXISTS reenvio jsonb',
      sch
    );
  END LOOP;
END $$;
