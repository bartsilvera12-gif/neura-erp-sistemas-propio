-- Campos extra para hallazgos de la auditoría funcional del negocio.
-- Formato pedido por Soporte: Función revisada / Esperado / Obtenido /
-- Recomendación / Evidencia. Son opcionales — los hallazgos de otras clases
-- de prueba simplemente no los llenan.

ALTER TABLE qa_center.findings
  ADD COLUMN IF NOT EXISTS funcion_revisada   text,
  ADD COLUMN IF NOT EXISTS resultado_esperado text,
  ADD COLUMN IF NOT EXISTS resultado_obtenido text,
  ADD COLUMN IF NOT EXISTS recomendacion      text,
  ADD COLUMN IF NOT EXISTS evidencia_url      text,
  ADD COLUMN IF NOT EXISTS modulo_negocio     text;
