-- =============================================================================
-- Foto de perfil del usuario
--
-- `avatar_path` y no `avatar_url`: el bucket es privado, así que lo que se
-- guarda es la ubicación del archivo y la URL se firma en cada lectura. Una URL
-- guardada en la base sería una URL vencida a la hora.
--
-- Se agrega en todos los esquemas que tengan `usuarios`, porque el catálogo
-- vive en `neura` en esta instancia y en otro esquema en otras.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'usuarios' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    EXECUTE format(
      'ALTER TABLE %I.usuarios ADD COLUMN IF NOT EXISTS avatar_path text', sch);
  END LOOP;
END $$;

-- Sin esto la API sigue contestando 400 "could not find column in schema cache".
NOTIFY pgrst, 'reload schema';
