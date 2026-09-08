-- =============================================================================
-- Foto del grupo
--
-- `avatar_path` igual que en `usuarios`: el bucket es privado, así que se
-- guarda la ubicación del archivo y la URL se firma en cada lectura.
--
-- `nombre` y `descripcion` ya existían en la tabla; lo que faltaba era la foto
-- y poder cambiar las tres cosas en cualquier momento, que es de la API.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_interno_salas' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    EXECUTE format(
      'ALTER TABLE %I.chat_interno_salas ADD COLUMN IF NOT EXISTS avatar_path text', sch);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
