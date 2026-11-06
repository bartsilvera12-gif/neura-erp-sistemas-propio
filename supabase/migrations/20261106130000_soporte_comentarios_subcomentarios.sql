-- =============================================================================
-- Soporte · subcomentarios (respuestas a un comentario de ticket)
-- -----------------------------------------------------------------------------
-- Operaciones pide poder responder un comentario (hilo de 1 nivel) y adjuntar
-- archivos en esas respuestas. Un subcomentario es una fila más en
-- `soporte_ticket_comentarios` apuntando a su comentario padre con `parent_id`.
-- Los adjuntos ya se vinculan por `comentario_id`, así que un subcomentario
-- recibe archivos sin cambios en `soporte_ticket_archivos`.
--
-- Aditiva e idempotente. Solo schema `neura` (ver regla del proyecto).
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

-- Respuesta a un comentario: misma tabla, apuntando al padre. Al borrar el
-- comentario padre se borran sus respuestas (CASCADE); los adjuntos de esas
-- respuestas quedan con comentario_id en NULL (ON DELETE SET NULL ya definido).
ALTER TABLE neura.soporte_ticket_comentarios
  ADD COLUMN IF NOT EXISTS parent_id uuid
  REFERENCES neura.soporte_ticket_comentarios(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ix_sop_com_parent_neura
  ON neura.soporte_ticket_comentarios (parent_id, created_at)
  WHERE parent_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
