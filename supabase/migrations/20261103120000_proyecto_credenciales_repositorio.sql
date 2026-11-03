-- Repositorio de GitHub asociado a una credencial de proyecto, en formato
-- owner/repo (ej. bartsilvera12-gif/neura-erp-mevo). Lo elige el selector de
-- repos en Proyectos -> Credenciales (con buscador) y se muestra tambien en
-- Soporte (Accesos del proyecto), que lee la misma tabla.
--
-- Aditiva, nullable: no toca ninguna credencial existente. SOLO neura. Idempotente.

ALTER TABLE neura.proyecto_credenciales
  ADD COLUMN IF NOT EXISTS repositorio text;

-- La tabla se consume por PostgREST (schema neura expuesto): sin recargar el
-- cache de esquema la API no ve la columna nueva y da 400 al guardar/seleccionar.
NOTIFY pgrst, 'reload schema';
