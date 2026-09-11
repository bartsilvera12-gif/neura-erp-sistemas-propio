-- =============================================================================
-- Guardias de la semana
--
-- Quién está de guardia se acordaba por WhatsApp y se olvidaba. La consecuencia
-- no es un dato faltante: es que un pedido urgente un sábado no sabe a quién
-- ir, o le cae a alguien que no estaba de turno.
--
-- Una fila por semana y por empresa, con la fecha del LUNES como clave. Guardar
-- el lunes y no un rango evita la pregunta de qué pasa si dos rangos se pisan:
-- no pueden, porque el índice único lo impide.
--
-- Los tres roles van en columnas y no en una tabla de asignaciones: son tres
-- fijos —PM, soporte principal y suplente—, no una lista que crezca, y así la
-- semana entera se lee de una fila sin joins.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'usuarios' AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE c2.relname = 'empresas' AND n2.nspname = n.nspname)
    ORDER BY 1
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.guardias_semana (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id         uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
        -- Lunes de la semana. Se valida para que no entre un martes por error y
        -- queden dos filas describiendo la misma semana.
        semana_inicio      date NOT NULL,
        pm_id              uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
        soporte_principal_id uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
        soporte_suplente_id  uuid REFERENCES %I.usuarios(id) ON DELETE SET NULL,
        notas              text,
        created_by         uuid,
        updated_by         uuid,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_guardias_semana_lunes CHECK (EXTRACT(ISODOW FROM semana_inicio) = 1)
      )
    $f$, r.sch, r.sch, r.sch, r.sch, r.sch);

    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.guardias_semana (empresa_id, semana_inicio)',
      'uq_guardias_semana_' || md5(r.sch), r.sch);

    -- Las tablas nuevas nacen sin ACL: sin esto la API responde 42501.
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON %I.guardias_semana TO authenticated, service_role',
      r.sch);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
