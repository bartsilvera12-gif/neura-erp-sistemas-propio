-- Teléfono real del contacto, SOLO para mostrar (no reemplaza phone_number ni wa_jid).
--
-- Por qué: en el canal WhatsApp por QR (Baileys) muchos chats llegan identificados por un
-- @lid (código interno) en vez del teléfono. El puente, cuando conoce el teléfono real
-- (de `senderPn` o de la libreta de WhatsApp), lo manda al ERP en `fromPhone` / por el
-- endpoint /telefonos. Antes el ERP lo descartaba (la corrección por renombre estaba apagada
-- porque partía el chat). Ahora se guarda acá, APARTE, para mostrarlo en el inbox y la ficha
-- sin tocar la identidad del contacto:
--   - phone_number sigue siendo el @lid → no se parte el chat, no se duplica, no cambia el envío.
--   - telefono_real es lo que se MUESTRA cuando existe.
--
-- Nullable y aditivo. Los contactos normales no lo usan (su phone_number ya es su teléfono).

ALTER TABLE neura.chat_contacts
  ADD COLUMN IF NOT EXISTS telefono_real text;

COMMENT ON COLUMN neura.chat_contacts.telefono_real IS
  'Teléfono real del contacto cuando phone_number es un @lid de WhatsApp. Solo para mostrar '
  '(inbox/ficha). NO reemplaza phone_number ni wa_jid, no cambia el envío ni la identidad.';
