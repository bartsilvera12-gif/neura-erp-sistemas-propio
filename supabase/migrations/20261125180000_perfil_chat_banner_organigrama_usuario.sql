-- Perfil del chat interno: banner propio (color de la paleta o imagen subida).
ALTER TABLE neura.usuarios
  ADD COLUMN IF NOT EXISTS banner_color text,
  ADD COLUMN IF NOT EXISTS banner_path text;

-- Organigrama: vincular cada puesto con su usuario (la columna usuario_id ya existía, vacía).
-- Primer llenado por nombre: cada palabra del nombre del puesto tiene que ser el comienzo de una
-- palabra del nombre completo del usuario (sin tildes ni mayúsculas), y el usuario tiene que ser único.
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT table_schema FROM information_schema.columns
           WHERE table_name = 'organigrama_nodos' AND column_name = 'usuario_id'
  LOOP
    EXECUTE format($q$
      WITH cand AS (
        SELECT n.id AS nodo_id, u.id AS usuario_id
        FROM %I.organigrama_nodos n
        JOIN neura.usuarios u ON u.empresa_id = n.empresa_id
        WHERE n.usuario_id IS NULL AND coalesce(trim(n.nombre_persona), '') <> ''
          AND NOT EXISTS (
            SELECT 1 FROM regexp_split_to_table(translate(lower(trim(n.nombre_persona)), 'áéíóúüñ', 'aeiouun'), '\s+') t
            WHERE translate(lower(coalesce(u.nombre, '') || ' ' || coalesce(u.nombre_chat, '')), 'áéíóúüñ', 'aeiouun') !~ ('\m' || t)
          )
      ), unicos AS (
        SELECT nodo_id, min(usuario_id::text)::uuid AS usuario_id FROM cand GROUP BY nodo_id HAVING count(*) = 1
      )
      UPDATE %I.organigrama_nodos n SET usuario_id = unicos.usuario_id FROM unicos WHERE n.id = unicos.nodo_id
    $q$, s, s);
  END LOOP;
END $$;
