-- ============================================================================
-- Fase 5.2 — Roles del flujo de solicitudes de compra (configurable).
--
-- Define, por empresa, qué usuarios CONFIRMAN (Alan), PAGAN (Guillermo) y
-- RECIBEN. Se usa para rutear los avisos de la campanita a quien le toca (si un
-- rol no tiene a nadie, el aviso cae en los administradores). "Solicita" no se
-- guarda: cualquiera con el módulo Compras puede crear una solicitud.
--
-- Solo schema `neura`. Tabla nueva, no toca nada existente. La capa 2.0 la lee y
-- escribe con el pool (rol postgres, dueño), así que RLS sin políticas alcanza
-- (mismo patrón que pagos_proveedores). usuario_id apunta al catálogo de usuarios
-- (otro schema): sin FK cruzada a propósito.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS neura.compras_flujo_roles (
  empresa_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  confirma   boolean NOT NULL DEFAULT false,
  paga       boolean NOT NULL DEFAULT false,
  recibe     boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usuario_id)
);

ALTER TABLE neura.compras_flujo_roles ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
