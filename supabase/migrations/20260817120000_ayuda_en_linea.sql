-- =============================================================================
-- Ayuda en línea — base de conocimiento interna (procesos, políticas, info)
--
-- El asesor entra a /ayuda y consulta; un admin carga y edita el contenido desde
-- /configuracion/ayuda sin tocar código ni pedir deploy. Ese es el punto: si
-- cargar un artículo requiere un programador, el módulo muere a los dos meses.
--
-- Decisiones:
--  * `contenido_md` guarda Markdown. El editor tiene barra de formato (negrita,
--    listas, títulos…) para que lo use gente no técnica, pero el formato de
--    almacenamiento es texto plano: portable, diffeable y ya renderizable con
--    react-markdown, que el proyecto usa.
--  * `roles_visibles` vacío = visible para todos. Se guarda el rol normalizado
--    (minúsculas) de `usuarios.rol`; el admin siempre ve todo.
--  * `ayuda_articulo_versiones` guarda el texto ANTERIOR en cada edición. Sin
--    esto, un pegado mal hecho borra media hora de redacción sin vuelta atrás.
--  * `modulo` asocia el artículo a una pantalla del ERP (cobranzas, crm…) para
--    la ayuda contextual del botón "?" dentro de cada módulo.
--
-- SOLO schema `neura` (mismo criterio que Plan de Cuentas). Idempotente.
-- Aplicar: node scripts/apply-migration-file-pg.cjs <este archivo>  (o SSH psql).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Categorías (Procesos, Políticas, Comercial, …)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS neura.ayuda_categorias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  slug        text NOT NULL,
  descripcion text,
  orden       integer NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ayuda_categorias_slug_uk UNIQUE (empresa_id, slug),
  CONSTRAINT ayuda_categorias_nombre_non_empty CHECK (length(trim(nombre)) > 0)
);

CREATE INDEX IF NOT EXISTS ix_ayuda_categorias_empresa
  ON neura.ayuda_categorias (empresa_id, orden, nombre);

-- -----------------------------------------------------------------------------
-- Artículos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS neura.ayuda_articulos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  categoria_id   uuid REFERENCES neura.ayuda_categorias(id) ON DELETE SET NULL,
  titulo         text NOT NULL,
  slug           text NOT NULL,
  resumen        text,
  contenido_md   text NOT NULL DEFAULT '',
  -- Pantalla del ERP a la que pertenece (para el botón "?" contextual).
  modulo         text,
  -- Vacío = lo ven todos los roles. Se comparan roles normalizados en minúscula.
  roles_visibles text[] NOT NULL DEFAULT '{}',
  orden          integer NOT NULL DEFAULT 0,
  -- Borrador (false) vs publicado (true): se puede escribir sin exponerlo aún.
  publicado      boolean NOT NULL DEFAULT false,
  vistas         integer NOT NULL DEFAULT 0,
  creado_por     uuid REFERENCES neura.usuarios(id) ON DELETE SET NULL,
  actualizado_por uuid REFERENCES neura.usuarios(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ayuda_articulos_slug_uk UNIQUE (empresa_id, slug),
  CONSTRAINT ayuda_articulos_titulo_non_empty CHECK (length(trim(titulo)) > 0)
);

CREATE INDEX IF NOT EXISTS ix_ayuda_articulos_empresa
  ON neura.ayuda_articulos (empresa_id, publicado, orden, titulo);
CREATE INDEX IF NOT EXISTS ix_ayuda_articulos_categoria
  ON neura.ayuda_articulos (empresa_id, categoria_id);
CREATE INDEX IF NOT EXISTS ix_ayuda_articulos_modulo
  ON neura.ayuda_articulos (empresa_id, modulo) WHERE modulo IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ayuda_articulos_titulo_lower
  ON neura.ayuda_articulos (empresa_id, lower(titulo));

-- -----------------------------------------------------------------------------
-- Historial de versiones (snapshot del contenido ANTERIOR a cada edición)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS neura.ayuda_articulo_versiones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  articulo_id  uuid NOT NULL REFERENCES neura.ayuda_articulos(id) ON DELETE CASCADE,
  titulo       text NOT NULL,
  contenido_md text NOT NULL DEFAULT '',
  guardado_por uuid REFERENCES neura.usuarios(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ayuda_versiones_articulo
  ON neura.ayuda_articulo_versiones (empresa_id, articulo_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Feedback: "¿te sirvió?" — dice qué proceso está mal documentado
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS neura.ayuda_articulo_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  articulo_id uuid NOT NULL REFERENCES neura.ayuda_articulos(id) ON DELETE CASCADE,
  usuario_id  uuid REFERENCES neura.usuarios(id) ON DELETE SET NULL,
  util        boolean NOT NULL,
  comentario  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ayuda_feedback_uk UNIQUE (articulo_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS ix_ayuda_feedback_articulo
  ON neura.ayuda_articulo_feedback (empresa_id, articulo_id);

-- -----------------------------------------------------------------------------
-- RLS + privilegios (mismo criterio que el resto de `neura`)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ayuda_categorias',
    'ayuda_articulos',
    'ayuda_articulo_versiones',
    'ayuda_articulo_feedback'
  ] LOOP
    EXECUTE format('ALTER TABLE neura.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON neura.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON neura.%I FOR SELECT USING (neura.puede_acceder_empresa(empresa_id))',
      t || '_select', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON neura.%I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON neura.%I FOR INSERT WITH CHECK (neura.puede_acceder_empresa(empresa_id))',
      t || '_insert', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON neura.%I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON neura.%I FOR UPDATE USING (neura.puede_acceder_empresa(empresa_id)) WITH CHECK (neura.puede_acceder_empresa(empresa_id))',
      t || '_update', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON neura.%I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON neura.%I FOR DELETE USING (neura.puede_acceder_empresa(empresa_id))',
      t || '_delete', t
    );

    -- Sin GRANT explícito la API responde 42501: las tablas creadas por
    -- supabase_admin nacen con ACL nula (ver nota en proyecto_credenciales).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON neura.%I TO authenticated', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON neura.%I TO service_role', t);
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON neura.%I', 'tr_' || t || '_updated', t);
    IF t <> 'ayuda_articulo_versiones' THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON neura.%I FOR EACH ROW EXECUTE FUNCTION neura.set_updated_at()',
        'tr_' || t || '_updated', t
      );
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Categorías iniciales por empresa (solo si la empresa no tiene ninguna)
-- -----------------------------------------------------------------------------
INSERT INTO neura.ayuda_categorias (empresa_id, nombre, slug, descripcion, orden)
SELECT e.id, c.nombre, c.slug, c.descripcion, c.orden
FROM neura.empresas e
CROSS JOIN (VALUES
  ('Procesos',    'procesos',    'Cómo se hace cada cosa, paso a paso.',            10),
  ('Políticas',   'politicas',   'Reglas de la empresa: descuentos, permisos, etc.', 20),
  ('Comercial',   'comercial',   'Venta, seguimiento de leads y cierre.',            30),
  ('Cobranzas',   'cobranzas',   'Gestión de cuotas, promesas de pago y morosidad.', 40),
  ('Sistema',     'sistema',     'Cómo usar cada módulo del ERP.',                   50),
  ('Preguntas frecuentes', 'faq', 'Las dudas que más se repiten.',                   60)
) AS c(nombre, slug, descripcion, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM neura.ayuda_categorias a WHERE a.empresa_id = e.id
)
ON CONFLICT (empresa_id, slug) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
