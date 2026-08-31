-- Subcategorías en la Ayuda en línea.
--
-- POR QUÉ: `ayuda_categorias` era una lista plana, y hay material que sólo se
-- entiende anidado — "Desarrollo → Páginas Web" separa la guía de SEO de, por
-- ejemplo, un instructivo de SaaS, sin inventar una categoría suelta llamada
-- "Páginas Web" que en el índice quedaría al mismo nivel que "Desarrollo".
--
-- MODELO: auto-referencia nullable. Una categoría sin `parent_id` es de primer
-- nivel; con `parent_id` es hija. Un solo nivel de anidamiento en la práctica:
-- el lector agrupa padre → hijas y no recorre más hondo.
--
-- ON DELETE SET NULL: si se borra la categoría padre, las hijas no se pierden,
-- suben a primer nivel. Perder artículos por borrar un contenedor sería peor.
--
-- ALCANCE: la tabla existe en un solo schema (`neura`), así que el cambio
-- queda naturalmente acotado a este tenant.

ALTER TABLE neura.ayuda_categorias
  ADD COLUMN IF NOT EXISTS parent_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ayuda_categorias_parent_id_fkey'
      AND conrelid = 'neura.ayuda_categorias'::regclass
  ) THEN
    ALTER TABLE neura.ayuda_categorias
      ADD CONSTRAINT ayuda_categorias_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES neura.ayuda_categorias(id) ON DELETE SET NULL;
  END IF;

  -- Una categoría no puede ser su propia madre. No cubre ciclos largos
  -- (A→B→A), pero con un solo nivel de anidamiento no hay forma de armarlos
  -- desde la UI, y un CHECK recursivo no se puede expresar acá.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ayuda_categorias_parent_no_self'
      AND conrelid = 'neura.ayuda_categorias'::regclass
  ) THEN
    ALTER TABLE neura.ayuda_categorias
      ADD CONSTRAINT ayuda_categorias_parent_no_self CHECK (parent_id IS DISTINCT FROM id);
  END IF;
END $$;

-- El acceso natural es "las hijas de esta categoría".
CREATE INDEX IF NOT EXISTS ayuda_categorias_parent_id_idx
  ON neura.ayuda_categorias (parent_id) WHERE parent_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
