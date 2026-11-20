-- =============================================================================
-- NEURA QA CENTER — ROLLBACK ESPECÍFICO para la activación del 2026-11-12.
-- Revierte exactamente lo que insertan:
--   - 20261113000000_qa_center_catalog_module.sql
--   - qa_center_access_seed.sql
-- Orden FK-safe: primero usuario_modulos, luego empresa_modulos, luego modulos.
-- Acotado por slug='qa_center' + emails + empresa Neura UUID: nunca toca otra fila.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout    = '5s';

BEGIN;

-- 1) Retirar asignación individual SOLO de los 4 emails autorizados.
DELETE FROM neura.usuario_modulos
 WHERE modulo_id = (SELECT id FROM neura.modulos WHERE slug='qa_center')
   AND usuario_id IN (
     SELECT id FROM neura.usuarios WHERE email IN (
       'alanayalapsn@gmail.com',
       'bartsilvera12@gmail.com',
       'emaxigui@gmail.com',
       'ivannicomar88@hotmail.com',
       'julicontreras1912@gmail.com'
     )
   );

-- 2) Retirar el vínculo empresa_modulos SOLO para Neura.
DELETE FROM neura.empresa_modulos
 WHERE empresa_id = '9fd29108-4b0f-4faf-9eee-c509f6227d47'::uuid
   AND modulo_id  = (SELECT id FROM neura.modulos WHERE slug='qa_center');

-- 3) Retirar el módulo del catálogo (FKs ya removidos arriba).
DELETE FROM neura.modulos WHERE slug='qa_center';

COMMIT;
