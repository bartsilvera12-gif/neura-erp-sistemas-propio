-- =============================================================================
-- Cumpleaños en el perfil del chat interno
--
-- Día y mes, sin año: alcanza para saludar y nadie tiene que decir su edad.
-- Vacío = no cargó cumpleaños. Sólo el schema de Neura.
-- =============================================================================

ALTER TABLE neura.usuarios
  ADD COLUMN IF NOT EXISTS cumple_mes smallint,
  ADD COLUMN IF NOT EXISTS cumple_dia smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_cumple_valido') THEN
    ALTER TABLE neura.usuarios
      ADD CONSTRAINT usuarios_cumple_valido CHECK (
        (cumple_mes IS NULL AND cumple_dia IS NULL)
        OR (cumple_mes BETWEEN 1 AND 12 AND cumple_dia BETWEEN 1 AND 31)
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
