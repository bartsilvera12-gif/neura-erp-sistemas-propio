-- ============================================================================
-- Palabras clave / sinónimos por producto para el buscador.
--
-- Agrega `palabras_clave text` (sinónimos y términos relacionados) a
-- `neura.productos`. El buscador inteligente ya los incluye (unaccent + pg_trgm),
-- así que "efectivo" puede encontrar "Cajón de dinero" si se cargan ahí.
--
-- Solo schema `neura`. Columna nueva, nullable: no toca datos existentes. La capa
-- 2.0 la lee/escribe con el pool (postgres), así que no requiere GRANT aparte;
-- igual se recarga PostgREST por si algún path lo usa.
-- ============================================================================
ALTER TABLE neura.productos ADD COLUMN IF NOT EXISTS palabras_clave text;

NOTIFY pgrst, 'reload schema';
