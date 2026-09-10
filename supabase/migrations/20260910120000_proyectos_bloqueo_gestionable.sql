-- =============================================================================
-- Un bloqueo que se puede gestionar
--
-- Hoy pausar un proyecto pide un motivo y guarda desde cuándo. Con eso alcanza
-- para saber que está detenido, pero no para destrabarlo: falta quién tiene que
-- resolverlo y qué es lo próximo que hay que hacer. Sin esas dos cosas, la
-- columna "Pausado" es un depósito.
--
-- Se agregan:
--
--   · bloqueo_responsable    — quién debe destrabarlo, como rol y no como
--                              persona: la mitad de los bloqueos los traba el
--                              cliente o un proveedor, que no son usuarios del
--                              sistema. Al ser un valor cerrado se puede contar
--                              ("cuántos proyectos están trabados por el
--                              cliente"), que es el punto.
--   · bloqueo_proxima_accion — qué se hace para destrabarlo.
--
-- El "desde cuándo" ya existe (`pausado_at`) y el motivo también
-- (`bloqueo_motivo`), así que no se duplican.
--
-- `bloqueo_tipo` (cliente/interno/tercero) queda como está: es la categoría
-- gruesa que ya leen el dashboard y los reportes. La aplicación la deriva del
-- responsable para no pedir el mismo dato dos veces.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyectos'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'bloqueo_motivo' AND NOT a.attisdropped)
    ORDER BY 1
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS bloqueo_responsable text',
      r.sch);
    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS bloqueo_proxima_accion text',
      r.sch);

    -- Valor cerrado, pero con NULL permitido: los bloqueos que ya existen no
    -- tienen responsable cargado y no se inventa uno.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'chk_proyectos_bloqueo_responsable'
        AND conrelid = format('%I.proyectos', r.sch)::regclass
    ) THEN
      EXECUTE format($f$
        ALTER TABLE %I.proyectos
          ADD CONSTRAINT chk_proyectos_bloqueo_responsable
          CHECK (bloqueo_responsable IS NULL OR bloqueo_responsable IN
                 ('cliente','pm','programador','qa','comercial','tercero'))
      $f$, r.sch);
    END IF;

    -- Las columnas nuevas nacen sin ACL propia, pero heredan la de la tabla:
    -- el GRANT va igual por si el rol se otorgó columna por columna.
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE ON %I.proyectos TO authenticated, service_role',
      r.sch);
  END LOOP;
END $$;

-- Sin esto la API responde 400 "could not find column in schema cache".
NOTIFY pgrst, 'reload schema';
