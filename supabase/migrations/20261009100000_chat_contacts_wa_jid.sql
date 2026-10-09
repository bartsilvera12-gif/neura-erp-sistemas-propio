-- Preserva el JID original de WhatsApp por contacto (`<id>@lid` o `<pn>@s.whatsapp.net`).
--
-- Por qué: el canal WhatsApp por QR (Baileys) identifica muchos chats con un `@lid`
-- (código interno). El puente mandaba solo los dígitos y el ERP, al responder, forzaba
-- `<digitos>@s.whatsapp.net`. Para un @lid eso arma un número de teléfono inexistente y el
-- mensaje NO llega (Baileys sí sabe enviar a `<id>@lid` si se le pasa el JID correcto).
--
-- Solución (Fase 1): el inbound guarda acá el JID original con su sufijo real, y el envío
-- lo reusa tal cual para direccionar al tipo correcto. NO se renombra phone_number (eso
-- partía la conversación en dos); el JID se guarda aparte.
--
-- Nullable y aditivo. Las filas viejas (sin wa_jid) caen a un heurístico por longitud al
-- enviar, y se van completando solas a medida que el contacto escribe de nuevo.

ALTER TABLE neura.chat_contacts
  ADD COLUMN IF NOT EXISTS wa_jid text;

COMMENT ON COLUMN neura.chat_contacts.wa_jid IS
  'JID original de WhatsApp (<id>@lid o <pn>@s.whatsapp.net) con el que llega el contacto por '
  'el canal Baileys. Se usa al responder para direccionar al tipo correcto (un @lid como @lid), '
  'sin forzar @s.whatsapp.net. No reemplaza phone_number.';
