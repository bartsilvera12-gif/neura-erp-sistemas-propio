-- Propuestas: clientes bandera que se muestran en el pie de cada propuesta.
ALTER TABLE neura.propuestas ADD COLUMN IF NOT EXISTS clientes_bandera jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
