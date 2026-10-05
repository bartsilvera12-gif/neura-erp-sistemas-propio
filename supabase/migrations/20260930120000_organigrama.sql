-- =============================================================================
-- Módulo Organigrama — árbol de cargos por empresa (SOLO schema neura).
-- Jerárquico auto-referenciado (parent_id). No toca otros schemas.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS neura.organigrama_nodos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  parent_id      uuid REFERENCES neura.organigrama_nodos(id) ON DELETE SET NULL,
  titulo         text NOT NULL,
  nombre_persona text,
  usuario_id     uuid,
  orden          integer NOT NULL DEFAULT 0,
  color          text,
  foto_url       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organigrama_nodos_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS ix_organigrama_nodos_empresa ON neura.organigrama_nodos(empresa_id);
CREATE INDEX IF NOT EXISTS ix_organigrama_nodos_padre   ON neura.organigrama_nodos(parent_id);

-- updated_at
DROP TRIGGER IF EXISTS organigrama_nodos_set_updated_at ON neura.organigrama_nodos;
CREATE TRIGGER organigrama_nodos_set_updated_at
  BEFORE UPDATE ON neura.organigrama_nodos
  FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at();

-- RLS por empresa
ALTER TABLE neura.organigrama_nodos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organigrama_nodos_select ON neura.organigrama_nodos;
DROP POLICY IF EXISTS organigrama_nodos_insert ON neura.organigrama_nodos;
DROP POLICY IF EXISTS organigrama_nodos_update ON neura.organigrama_nodos;
DROP POLICY IF EXISTS organigrama_nodos_delete ON neura.organigrama_nodos;

CREATE POLICY organigrama_nodos_select ON neura.organigrama_nodos FOR SELECT
  USING (neura.puede_acceder_empresa(empresa_id));
CREATE POLICY organigrama_nodos_insert ON neura.organigrama_nodos FOR INSERT
  WITH CHECK (neura.puede_acceder_empresa(empresa_id));
CREATE POLICY organigrama_nodos_update ON neura.organigrama_nodos FOR UPDATE
  USING (neura.puede_acceder_empresa(empresa_id))
  WITH CHECK (neura.puede_acceder_empresa(empresa_id));
CREATE POLICY organigrama_nodos_delete ON neura.organigrama_nodos FOR DELETE
  USING (neura.puede_acceder_empresa(empresa_id));

-- GRANTs (sin ellos la API devuelve 42501: las tablas creadas por supabase_admin nacen con ACL nula).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON neura.organigrama_nodos TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON neura.organigrama_nodos TO service_role';
  END IF;
END $$;

COMMIT;

-- Recargar el schema cache de PostgREST para que la tabla nueva sea visible por la API.
SELECT pg_notify('pgrst', 'reload schema');

-- =============================================================================
-- Registro del módulo en el catálogo + habilitación por empresa.
-- Sin esto, el ítem del menú queda OCULTO (resolveEffectiveModules exige que el
-- módulo exista en neura.modulos y esté activo en empresa_modulos). Idempotente.
-- =============================================================================
INSERT INTO neura.modulos (nombre, slug, descripcion)
SELECT 'Organigrama', 'organigrama', 'Estructura organizacional (árbol de cargos)'
WHERE NOT EXISTS (SELECT 1 FROM neura.modulos WHERE slug = 'organigrama');

INSERT INTO neura.empresa_modulos (empresa_id, modulo_id, activo)
SELECT DISTINCT em.empresa_id, m.id, true
FROM neura.empresa_modulos em
CROSS JOIN neura.modulos m
WHERE m.slug = 'organigrama'
  AND NOT EXISTS (
    SELECT 1 FROM neura.empresa_modulos em2
    WHERE em2.empresa_id = em.empresa_id AND em2.modulo_id = m.id
  );

-- =============================================================================
-- Doble jefatura: co-jefes (jefes adicionales al parent_id). Idempotente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS neura.organigrama_nodo_jefes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  nodo_id    uuid NOT NULL REFERENCES neura.organigrama_nodos(id) ON DELETE CASCADE,
  jefe_id    uuid NOT NULL REFERENCES neura.organigrama_nodos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organigrama_nodo_jefes_uniq UNIQUE (nodo_id, jefe_id),
  CONSTRAINT organigrama_nodo_jefes_no_self CHECK (nodo_id <> jefe_id)
);
CREATE INDEX IF NOT EXISTS ix_org_nodo_jefes_nodo ON neura.organigrama_nodo_jefes(nodo_id);
CREATE INDEX IF NOT EXISTS ix_org_nodo_jefes_jefe ON neura.organigrama_nodo_jefes(jefe_id);
CREATE INDEX IF NOT EXISTS ix_org_nodo_jefes_emp  ON neura.organigrama_nodo_jefes(empresa_id);

ALTER TABLE neura.organigrama_nodo_jefes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_nodo_jefes_select ON neura.organigrama_nodo_jefes;
DROP POLICY IF EXISTS org_nodo_jefes_insert ON neura.organigrama_nodo_jefes;
DROP POLICY IF EXISTS org_nodo_jefes_update ON neura.organigrama_nodo_jefes;
DROP POLICY IF EXISTS org_nodo_jefes_delete ON neura.organigrama_nodo_jefes;
CREATE POLICY org_nodo_jefes_select ON neura.organigrama_nodo_jefes FOR SELECT USING (neura.puede_acceder_empresa(empresa_id));
CREATE POLICY org_nodo_jefes_insert ON neura.organigrama_nodo_jefes FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id));
CREATE POLICY org_nodo_jefes_update ON neura.organigrama_nodo_jefes FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id));
CREATE POLICY org_nodo_jefes_delete ON neura.organigrama_nodo_jefes FOR DELETE USING (neura.puede_acceder_empresa(empresa_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON neura.organigrama_nodo_jefes TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON neura.organigrama_nodo_jefes TO service_role';
  END IF;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
