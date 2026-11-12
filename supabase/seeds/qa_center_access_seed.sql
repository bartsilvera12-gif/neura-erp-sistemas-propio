-- =============================================================================
-- NEURA QA CENTER — seed de acceso para equipo interno Neura.
-- PREPARADO, NO EJECUTADO. Asignaciones aditivas (ON CONFLICT DO NOTHING).
--
-- Requiere que `20261113000000_qa_center_catalog_module.sql` ya haya corrido.
--
-- Scope:
--   1. Activa qa_center en empresa_modulos para la empresa Neura.
--   2. Asigna qa_center a los usuarios internos del equipo Neura.
-- NO se incluyen usuarios de otras empresas (los super_admin globales acceden
-- sin necesidad de asignación individual).
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout    = '5s';

BEGIN;

-- Validación defensiva: si el módulo o la empresa no existen, abortar.
DO $$
DECLARE
  _mod_id uuid;
  _emp_id uuid;
BEGIN
  SELECT id INTO _mod_id FROM neura.modulos WHERE slug='qa_center';
  IF _mod_id IS NULL THEN
    RAISE EXCEPTION 'módulo qa_center no existe; aplicar primero 20261113000000_qa_center_catalog_module.sql';
  END IF;

  SELECT id INTO _emp_id FROM neura.empresas
   WHERE id='9fd29108-4b0f-4faf-9eee-c509f6227d47'
     AND data_schema='neura';
  IF _emp_id IS NULL THEN
    RAISE EXCEPTION 'empresa Neura interna no identificada (id o data_schema no coinciden)';
  END IF;
END $$;

-- 1) Activar qa_center en la empresa Neura (idempotente).
INSERT INTO neura.empresa_modulos (empresa_id, modulo_id, activo)
SELECT
  '9fd29108-4b0f-4faf-9eee-c509f6227d47'::uuid,
  (SELECT id FROM neura.modulos WHERE slug='qa_center'),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM neura.empresa_modulos em
    JOIN neura.modulos m ON m.id = em.modulo_id
   WHERE em.empresa_id='9fd29108-4b0f-4faf-9eee-c509f6227d47'::uuid
     AND m.slug='qa_center'
);

-- Si existe pero estaba inactiva, la activamos.
UPDATE neura.empresa_modulos em
   SET activo = true
  FROM neura.modulos m
 WHERE em.modulo_id = m.id
   AND em.empresa_id = '9fd29108-4b0f-4faf-9eee-c509f6227d47'::uuid
   AND m.slug = 'qa_center'
   AND em.activo IS DISTINCT FROM true;

-- 2) Asignar a los usuarios internos del equipo Neura.
-- EDITABLE: ajustar la lista de emails antes de ejecutar según decisión del admin.
INSERT INTO neura.usuario_modulos (usuario_id, modulo_id)
SELECT u.id, (SELECT id FROM neura.modulos WHERE slug='qa_center')
  FROM neura.usuarios u
 WHERE u.email IN (
   'alanayalapsn@gmail.com',       -- Alan Ayala       (administrador)
   'bartsilvera12@gmail.com',      -- Bart Silvera     (administrador)
   'emaxigui@gmail.com',           -- Emmanuel Guillen (usuario)
   'ivannicomar88@hotmail.com',    -- Iván Nico        (administrador)
   'julicontreras1912@gmail.com'   -- Juliana Contreras (administrador)
 )
   AND u.empresa_id = '9fd29108-4b0f-4faf-9eee-c509f6227d47'::uuid
   AND NOT EXISTS (
     SELECT 1 FROM neura.usuario_modulos um
      WHERE um.usuario_id = u.id
        AND um.modulo_id = (SELECT id FROM neura.modulos WHERE slug='qa_center')
   );

COMMIT;

-- Chequeos post-seed (ejecutar manualmente):
-- a) Empresa Neura tiene qa_center activo:
--    SELECT em.activo FROM neura.empresa_modulos em JOIN neura.modulos m ON m.id=em.modulo_id
--     WHERE em.empresa_id='9fd29108-4b0f-4faf-9eee-c509f6227d47' AND m.slug='qa_center';
--
-- b) Usuarios con qa_center asignado:
--    SELECT u.email FROM neura.usuario_modulos um
--      JOIN neura.usuarios u ON u.id=um.usuario_id
--      JOIN neura.modulos m ON m.id=um.modulo_id
--     WHERE m.slug='qa_center' ORDER BY u.email;
--
-- c) Reversión (quitar acceso a un usuario específico):
--    DELETE FROM neura.usuario_modulos
--     WHERE usuario_id=(SELECT id FROM neura.usuarios WHERE email='X')
--       AND modulo_id=(SELECT id FROM neura.modulos WHERE slug='qa_center');
