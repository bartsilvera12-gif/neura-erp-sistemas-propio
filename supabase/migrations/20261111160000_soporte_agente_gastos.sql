-- =============================================================================
-- Soporte · gasto del agente de IA (Neurita)
-- -----------------------------------------------------------------------------
-- El agente llevaba lo que gasta en un archivo dentro de su contenedor, por mes
-- y por ticket. Desde el ERP no se podía leer, y "cuánto gastó hoy" no existía
-- en ningún lado. Ahora el agente informa cada gasto por la API y queda acá.
--
-- Una fila por vuelta del modelo. `fecha` es el día de Paraguay, guardado por
-- quien informa: así "hoy" no depende de la zona del servidor.
--
-- Append-only, como el historial del ticket: se agrega y se lee, no se edita ni
-- se borra. Aditiva e idempotente. Solo schema `neura` (ver regla del proyecto).
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS neura.soporte_agente_gastos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES neura.empresas(id) ON DELETE CASCADE,
  -- Día de Paraguay en que se gastó (no el instante UTC).
  fecha         date NOT NULL,
  -- Número del ticket que lo originó. Puede faltar: hay gasto fuera de un ticket.
  ticket_numero integer,
  -- Dólares de esa vuelta. Son centavos: cuatro decimales para no perder nada al sumar.
  usd           numeric(10, 4) NOT NULL CHECK (usd >= 0),
  -- Para rastrear de dónde salió (repo del cliente, etapa).
  detalle       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sop_gastos_fecha_neura
  ON neura.soporte_agente_gastos (empresa_id, fecha);

ALTER TABLE neura.soporte_agente_gastos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON neura.soporte_agente_gastos FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON neura.soporte_agente_gastos FROM service_role;
GRANT SELECT, INSERT ON neura.soporte_agente_gastos TO service_role;

NOTIFY pgrst, 'reload schema';
