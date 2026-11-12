-- =============================================================================
-- NEURA QA CENTER — seed de datos ficticios para smoke local.
-- NO SE APLICA AUTOMÁTICAMENTE. Lo ejecuta un humano cuando quiera habilitar
-- el primer run de prueba.
-- Idempotente: el INSERT usa ON CONFLICT DO NOTHING contra UNIQUE (slug) y
-- UNIQUE (project_id, slug) para poder re-ejecutar sin romper nada.
-- =============================================================================

BEGIN;

-- Proyecto QA (ficticio: el target_base_url apunta a `localhost` para asegurar
-- que un runner mal configurado NO golpee producción).
INSERT INTO qa_center.projects (slug, name, repo_url, default_branch, target_base_url, target_env)
VALUES (
  'qa-sample',
  'QA Sample · fake-app',
  'https://github.com/bartsilvera12-gif/neura-qa-runner',
  'main',
  'http://127.0.0.1:4555',
  'local'
)
ON CONFLICT (slug) DO NOTHING;

-- Suite de humo con una spec autorizada (whitelist estricta).
WITH p AS (SELECT id FROM qa_center.projects WHERE slug = 'qa-sample')
INSERT INTO qa_center.suites (project_id, slug, name, description, tags, specs, enabled)
SELECT p.id, 'smoke', 'Smoke contra fake-app',
       'Único spec read-only ejecutado contra el fake-app local del runner.',
       ARRAY['smoke','read-only']::text[],
       ARRAY['availability.spec.ts']::text[],
       true
FROM p
ON CONFLICT (project_id, slug) DO NOTHING;

COMMIT;

-- Chequeo
SELECT p.slug  AS project,
       s.slug  AS suite,
       s.specs AS whitelist,
       s.enabled
  FROM qa_center.projects p
  JOIN qa_center.suites   s ON s.project_id = p.id
 WHERE p.slug = 'qa-sample';
