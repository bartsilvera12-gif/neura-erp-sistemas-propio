-- Editar / eliminar comentarios de tickets de Soporte.
--
-- La capacidad se implementa en la API (PATCH/DELETE de
-- /api/soporte/tickets/[id]/comentarios/[comentarioId]); el permiso es
-- "solo el autor" y se valida ahí con la sesión. Lo único que necesita la base
-- es una marca de edición para que la UI muestre "editado".
--
-- Solo schema neura (sistemas-propio). La tabla ya tiene sus GRANTs (service_role),
-- así que la columna nueva los hereda; no hace falta GRANT extra.

ALTER TABLE neura.soporte_ticket_comentarios
  ADD COLUMN IF NOT EXISTS editado_at timestamptz;

-- Sin esto, PostgREST no ve la columna nueva y la API da 400 "could not find column".
NOTIFY pgrst, 'reload schema';
