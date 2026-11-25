-- El cumpleaños del chat (cumple_mes/cumple_dia) sale de la fecha de nacimiento cuando la hay:
-- así lo que se carga en la ficha del usuario o en el perfil del chat es una sola fecha.
CREATE OR REPLACE FUNCTION neura.usuarios_cumple_desde_nacimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fecha_nacimiento IS NOT NULL THEN
    NEW.cumple_mes := extract(month FROM NEW.fecha_nacimiento)::smallint;
    NEW.cumple_dia := extract(day FROM NEW.fecha_nacimiento)::smallint;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_usuarios_cumple_desde_nacimiento ON neura.usuarios;
CREATE TRIGGER trg_usuarios_cumple_desde_nacimiento
  BEFORE INSERT OR UPDATE OF fecha_nacimiento ON neura.usuarios
  FOR EACH ROW EXECUTE FUNCTION neura.usuarios_cumple_desde_nacimiento();

UPDATE neura.usuarios
SET cumple_mes = extract(month FROM fecha_nacimiento)::smallint,
    cumple_dia = extract(day FROM fecha_nacimiento)::smallint
WHERE fecha_nacimiento IS NOT NULL
  AND (cumple_mes IS DISTINCT FROM extract(month FROM fecha_nacimiento)::smallint
       OR cumple_dia IS DISTINCT FROM extract(day FROM fecha_nacimiento)::smallint);
