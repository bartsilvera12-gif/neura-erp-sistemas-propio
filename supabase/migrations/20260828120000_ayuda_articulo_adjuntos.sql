-- =============================================================================
-- Ayuda en línea — Adjuntos de artículos (PDF, Word, imágenes, etc.)
--
-- Un artículo puede llevar documentos descargables: el contrato modelo de Neura,
-- una planilla, un instructivo en PDF. Los bytes viven en un bucket privado de
-- Storage (`ayuda`), namespaced por empresa + artículo; acá guardamos solo el
-- metadato y el path. El acceso se sirve siempre con signed URLs de corta
-- duración (mismo criterio que los archivos de proyectos).
--
-- SOLO schema `neura`. Idempotente.
-- Aplicar: node scripts/apply-migration-file-pg.cjs <este archivo>  (o SSH psql).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS neura.ayuda_articulo_adjuntos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  articulo_id    uuid NOT NULL REFERENCES neura.ayuda_articulos(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'ayuda',
  storage_path   text NOT NULL,
  mime_type      text,
  size_bytes     bigint,
  orden          integer NOT NULL DEFAULT 0,
  subido_por     uuid REFERENCES neura.usuarios(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ayuda_adjuntos_nombre_non_empty CHECK (length(trim(nombre)) > 0)
);

CREATE INDEX IF NOT EXISTS ix_ayuda_adjuntos_articulo
  ON neura.ayuda_articulo_adjuntos (empresa_id, articulo_id, orden, created_at);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE neura.ayuda_articulo_adjuntos ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS ayuda_adjuntos_select ON neura.ayuda_articulo_adjuntos';
  EXECUTE 'CREATE POLICY ayuda_adjuntos_select ON neura.ayuda_articulo_adjuntos FOR SELECT USING (neura.puede_acceder_empresa(empresa_id))';
  EXECUTE 'DROP POLICY IF EXISTS ayuda_adjuntos_insert ON neura.ayuda_articulo_adjuntos';
  EXECUTE 'CREATE POLICY ayuda_adjuntos_insert ON neura.ayuda_articulo_adjuntos FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id))';
  EXECUTE 'DROP POLICY IF EXISTS ayuda_adjuntos_update ON neura.ayuda_articulo_adjuntos';
  EXECUTE 'CREATE POLICY ayuda_adjuntos_update ON neura.ayuda_articulo_adjuntos FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id))';
  EXECUTE 'DROP POLICY IF EXISTS ayuda_adjuntos_delete ON neura.ayuda_articulo_adjuntos';
  EXECUTE 'CREATE POLICY ayuda_adjuntos_delete ON neura.ayuda_articulo_adjuntos FOR DELETE USING (neura.puede_acceder_empresa(empresa_id))';

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON neura.ayuda_articulo_adjuntos TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON neura.ayuda_articulo_adjuntos TO service_role';
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
