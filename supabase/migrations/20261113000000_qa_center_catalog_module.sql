-- =============================================================================
-- NEURA QA CENTER — alta del módulo 'qa_center' en el catálogo del ERP.
-- Aditiva: SOLO inserta una fila en neura.modulos. No modifica otras filas
-- ni toca empresa_modulos / usuario_modulos (eso es trabajo del seed).
-- Idempotente (ON CONFLICT DO NOTHING). Reversible: DELETE WHERE slug='qa_center'.
-- PREPARADA, NO EJECUTADA.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout    = '5s';

BEGIN;

-- Idempotente sin depender de UNIQUE (la tabla no lo tiene sobre `slug`).
INSERT INTO neura.modulos (slug, nombre, descripcion)
SELECT
  'qa_center',
  'QA Center',
  'NEURA QA CENTER — panel interno de pruebas automatizadas. Solo para equipo Neura.'
WHERE NOT EXISTS (SELECT 1 FROM neura.modulos WHERE slug='qa_center');

-- Verificación:
SELECT id, slug, nombre FROM neura.modulos WHERE slug='qa_center';

COMMIT;

-- Reversión (si hiciera falta):
--   DELETE FROM neura.modulos WHERE slug='qa_center';
--   Nota: previamente deben removerse las referencias en empresa_modulos y
--   usuario_modulos — DELETE sin ON CASCADE fallará si hay FKs activos.
