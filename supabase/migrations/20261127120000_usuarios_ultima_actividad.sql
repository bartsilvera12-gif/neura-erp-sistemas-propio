-- Última vez que la persona estuvo usando el ERP (pestaña a la vista).
-- La marca el contador del chat de cada pantalla, como mucho una vez por minuto.
-- Sirve para mostrar "En línea" / "Activo hace…" con la actividad real.
ALTER TABLE neura.usuarios ADD COLUMN IF NOT EXISTS ultima_actividad_at timestamptz;
NOTIFY pgrst, 'reload schema';
