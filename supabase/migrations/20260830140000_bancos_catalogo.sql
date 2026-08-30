-- ============================================================================
-- Catálogo de BANCOS (banco de origen de transferencias) — schema neura.
--
-- El "banco de origen" de un cobro dejaba de ser texto libre: ahora sale de una
-- lista cerrada y gestionable desde Configuración → Bancos. Esta tabla es el
-- catálogo por empresa (alta/baja lógica/edición). El dropdown de los botones de
-- cobro consume de acá.
--
-- Anti-duplicado por nombre normalizado. RLS por empresa (igual que
-- cobros_pendientes). El alta desde la app va por service-role (fuera de RLS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS neura.bancos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  nombre      text NOT NULL,
  nombre_norm text NOT NULL,
  activo      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_bancos_nombre CHECK (btrim(nombre) <> '')
);

-- Un mismo banco no se repite por empresa (case/espacios-insensible).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bancos_empresa_nombre
  ON neura.bancos (empresa_id, nombre_norm);
CREATE INDEX IF NOT EXISTS ix_bancos_empresa_activo
  ON neura.bancos (empresa_id, activo);

ALTER TABLE neura.bancos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'neura' AND tablename = 'bancos' AND policyname = 'bancos_rls'
  ) THEN
    CREATE POLICY bancos_rls ON neura.bancos
      USING (neura.puede_acceder_empresa(empresa_id))
      WITH CHECK (neura.puede_acceder_empresa(empresa_id));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON neura.bancos TO authenticated, service_role;

-- Seed de bancos de Paraguay para la empresa neura. Idempotente (ON CONFLICT).
INSERT INTO neura.bancos (empresa_id, nombre, nombre_norm, sort_order)
SELECT '9fd29108-4b0f-4faf-9eee-c509f6227d47'::uuid, b.nombre,
       upper(regexp_replace(btrim(b.nombre), '\s+', ' ', 'g')), b.ord
FROM (VALUES
  ('Banco Continental', 1),
  ('Banco Itaú Paraguay', 2),
  ('Ueno Bank', 3),
  ('Banco Familiar', 4),
  ('Sudameris Bank', 5),
  ('Banco Atlas', 6),
  ('Banco GNB Paraguay', 7),
  ('Banco Basa', 8),
  ('Banco Río', 9),
  ('Visión Banco', 10),
  ('Banco Nacional de Fomento (BNF)', 11),
  ('Interfisa Banco', 12),
  ('Zeta Banco', 13),
  ('Solar Ahorro y Finanzas', 14),
  ('Citibank', 15),
  ('Banco do Brasil', 16)
) AS b(nombre, ord)
ON CONFLICT (empresa_id, nombre_norm) DO NOTHING;
