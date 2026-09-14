-- =============================================================================
-- Módulo "Proyectos en la app" (slug `proyectos_movil`) — solo registro de módulo.
-- SOLO schema `neura`. Idempotente. No toca datos de negocio.
-- Aplicar con: node scripts/apply-migration-file-pg.cjs <este archivo>
--
-- Para qué: habilita la pestaña Proyectos DENTRO de la app del asesor (/m/asesor).
-- Va como módulo aparte de `proyectos` a propósito: `proyectos` lo tienen todos los
-- administradores de la empresa por defecto, así que no sirve para una prueba acotada.
-- `proyectos_movil` está en MODULOS_RESTRINGIDOS (ver src/lib/modulos/modulos-restringidos.ts):
-- solo lo ve quien tenga una fila explícita en `usuario_modulos`, sin importar el rol.
--
-- Ojo: esta migración NO le da el módulo a nadie. Eso se hace desde /usuarios/[id],
-- tildando "Proyectos en la app" en la lista de módulos del usuario de prueba.
-- =============================================================================

-- 1) Alta del módulo en el catálogo (si no existe)
INSERT INTO neura.modulos (nombre, slug)
SELECT 'Proyectos en la app', 'proyectos_movil'
WHERE NOT EXISTS (SELECT 1 FROM neura.modulos WHERE slug = 'proyectos_movil');

-- 2) Activarlo a nivel empresa en las que ya gestionan módulos vía empresa_modulos.
--    Es habilitación de empresa, NO de usuario: al ser restringido sigue sin verse
--    hasta que alguien tenga la fila en usuario_modulos.
INSERT INTO neura.empresa_modulos (empresa_id, modulo_id, activo)
SELECT em.empresa_id, m.id, true
FROM (SELECT DISTINCT empresa_id FROM neura.empresa_modulos) em
CROSS JOIN neura.modulos m
WHERE m.slug = 'proyectos_movil'
  AND NOT EXISTS (
    SELECT 1 FROM neura.empresa_modulos x
    WHERE x.empresa_id = em.empresa_id AND x.modulo_id = m.id
  );
