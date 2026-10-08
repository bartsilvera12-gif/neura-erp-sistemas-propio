-- Alias de contactos del inbox (`chat_contacts.alias_de_contact_id`).
--
-- Por qué: WhatsApp 2024+ identifica muchos chats con un `@lid` (código interno
-- privado) en vez del teléfono. El bridge no siempre puede resolver el teléfono
-- real (depende de que el cliente esté en los contactos del celular vinculado),
-- entonces el ERP crea contactos "LID" distintos del contacto "real" aunque sean
-- la misma persona. Mergearlos destructivamente (borrar el LID y mover todo al
-- real) no sirve: WhatsApp sigue mandando el mismo LID para el mismo cliente, y
-- el ERP vuelve a crear el contacto LID al siguiente mensaje — bucle sin fin.
--
-- Solución: mantener el contacto LID vivo pero marcado como alias del real.
-- `saveIncomingMessage` sigue el alias y enruta el mensaje a la conversación del
-- real. El LID queda como "redirección permanente" — para siempre, incluso si
-- WhatsApp vuelve a mandar ese LID dentro de 6 meses.
--
-- La columna admite nullable (contactos normales no son alias de nada), tiene
-- ON DELETE SET NULL (si el real se borra, el alias deja de redirigir), y un
-- índice para que el seguimiento sea rápido.

ALTER TABLE neura.chat_contacts
  ADD COLUMN IF NOT EXISTS alias_de_contact_id uuid
    REFERENCES neura.chat_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_contacts_alias
  ON neura.chat_contacts(alias_de_contact_id)
  WHERE alias_de_contact_id IS NOT NULL;

-- Guarda contra loops: un contacto NO puede ser alias de sí mismo.
ALTER TABLE neura.chat_contacts
  DROP CONSTRAINT IF EXISTS chat_contacts_alias_no_self;
ALTER TABLE neura.chat_contacts
  ADD CONSTRAINT chat_contacts_alias_no_self
  CHECK (alias_de_contact_id IS NULL OR alias_de_contact_id <> id);

COMMENT ON COLUMN neura.chat_contacts.alias_de_contact_id IS
  'Si no es NULL, este contacto es un alias (redirección permanente) del contacto apuntado. '
  'Usado para unificar @lid de WhatsApp con el teléfono real sin perder el LID. '
  'saveIncomingMessage resuelve el alias y usa el id apuntado como contact_id efectivo.';
