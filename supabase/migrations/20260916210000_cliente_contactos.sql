-- =============================================================================
-- Contactos secundarios del cliente (schema neura)
--
-- Personas del cliente además de su contacto principal: encargado de
-- facturación, dueño, cajera… Se cargan desde Gestión de clientes y sirven
-- para reconocer al cliente cuando escribe por el chat (Soporte desde
-- Conversaciones busca el número también acá).
--
-- Sólo el schema `neura`. Aditiva e idempotente.
-- Solo API (service role): RLS sin políticas y sin acceso anon/authenticated.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS neura.cliente_contactos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  cliente_id  uuid NOT NULL REFERENCES neura.clientes(id) ON DELETE CASCADE,
  nombre      text NOT NULL CHECK (length(btrim(nombre)) > 0),
  telefono    text,
  email       text,
  cargo       text,
  notas       text,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cliente_contactos_cliente ON neura.cliente_contactos (empresa_id, cliente_id);
-- Para reconocer un número del chat: últimos 9 dígitos del teléfono.
CREATE INDEX IF NOT EXISTS ix_cliente_contactos_tel9
  ON neura.cliente_contactos (empresa_id, (right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 9)));

ALTER TABLE neura.cliente_contactos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON neura.cliente_contactos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.cliente_contactos TO service_role;

NOTIFY pgrst, 'reload schema';
