-- =============================================================================
-- Módulo "Panel (app sin chat)" (slug `panel_movil`) — solo registro de módulo.
-- SOLO schema `neura`. Idempotente. No toca datos de negocio.
-- Aplicar con: node scripts/apply-migration-file-pg.cjs <este archivo>
--
-- Para qué: pone la app `/m/asesor` en "modo panel" para quien lo tenga asignado.
-- En modo panel NO se muestra la pestaña Chats (la bandeja de conversaciones) y la
-- app abre directo en Proyectos. Pensado para administración / gente que usa la app
-- por Proyectos, Avisos y Soporte, y no atiende chats.
--
-- Es opt-in y restringido (ver src/lib/modulos/modulos-restringidos.ts): a quien NO
-- lo tenga —todos los asesores de hoy— la app le queda EXACTAMENTE igual, con Chats.
--
-- Ojo: este módulo NO reemplaza a `proyectos_movil`. Para que un usuario vea la app
-- en modo panel necesita AMBOS: `proyectos_movil` (habilita la barra y Proyectos) y
-- `panel_movil` (oculta Chats y entra directo a Proyectos). La pestaña Soporte, además,
-- exige su propio acceso (rol admin/super admin o el módulo `soporte`).
--
-- Esta migración NO le da el módulo a nadie. Eso se hace desde /usuarios/[id],
-- tildando "Panel (app sin chat)" en la lista de módulos del usuario.
-- =============================================================================

-- 1) Alta del módulo en el catálogo (si no existe)
INSERT INTO neura.modulos (nombre, slug)
SELECT 'Panel (app sin chat)', 'panel_movil'
WHERE NOT EXISTS (SELECT 1 FROM neura.modulos WHERE slug = 'panel_movil');

-- 2) Activarlo a nivel empresa en las que ya gestionan módulos vía empresa_modulos.
--    Es habilitación de empresa, NO de usuario: al ser restringido sigue sin verse
--    hasta que alguien tenga la fila en usuario_modulos.
INSERT INTO neura.empresa_modulos (empresa_id, modulo_id, activo)
SELECT em.empresa_id, m.id, true
FROM (SELECT DISTINCT empresa_id FROM neura.empresa_modulos) em
CROSS JOIN neura.modulos m
WHERE m.slug = 'panel_movil'
  AND NOT EXISTS (
    SELECT 1 FROM neura.empresa_modulos x
    WHERE x.empresa_id = em.empresa_id AND x.modulo_id = m.id
  );
