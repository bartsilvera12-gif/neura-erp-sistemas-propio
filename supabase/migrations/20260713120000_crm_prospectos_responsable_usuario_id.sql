-- Vínculo ROBUSTO lead ↔ asesor: id del usuario responsable (no solo el nombre).
-- Necesario para scopear el CRM Funnel por perfil: el asesor (usuario + omnicanal) ve SOLO
-- los leads donde responsable_usuario_id = su usuario; el admin ve todos. El nombre `responsable`
-- (texto) queda para display/compat; el id es la fuente de verdad del scope.
ALTER TABLE neura.crm_prospectos
  ADD COLUMN IF NOT EXISTS responsable_usuario_id uuid;

CREATE INDEX IF NOT EXISTS idx_crm_prospectos_responsable_usuario
  ON neura.crm_prospectos(empresa_id, responsable_usuario_id);

-- Backfill de leads existentes: matchea `responsable` (nombre) contra usuarios de la misma empresa.
-- Pasada 1: nombre exacto que matchea UN solo usuario (evita homónimos).
UPDATE neura.crm_prospectos p SET responsable_usuario_id = m.id
FROM (SELECT empresa_id, trim(lower(nombre)) AS nkey, min(id::text)::uuid AS id
      FROM neura.usuarios WHERE nombre IS NOT NULL AND trim(nombre) <> ''
      GROUP BY empresa_id, trim(lower(nombre)) HAVING count(*) = 1) m
WHERE p.responsable_usuario_id IS NULL AND p.responsable IS NOT NULL AND trim(p.responsable) <> ''
  AND p.empresa_id = m.empresa_id AND trim(lower(p.responsable)) = m.nkey;

-- Pasada 2: el responsable es prefijo de UN solo usuario (cubre nombres cortos como "PATRICIO").
UPDATE neura.crm_prospectos p SET responsable_usuario_id = m.id
FROM (SELECT r.empresa_id, r.rkey, min(u.id::text)::uuid AS id
      FROM (SELECT DISTINCT empresa_id, trim(lower(responsable)) AS rkey FROM neura.crm_prospectos
            WHERE responsable IS NOT NULL AND trim(responsable) <> '') r
      JOIN neura.usuarios u ON u.empresa_id = r.empresa_id AND lower(trim(u.nombre)) LIKE r.rkey || '%'
      GROUP BY r.empresa_id, r.rkey HAVING count(*) = 1) m
WHERE p.responsable_usuario_id IS NULL AND p.responsable IS NOT NULL
  AND p.empresa_id = m.empresa_id AND trim(lower(p.responsable)) = m.rkey;
