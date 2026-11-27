-- NEURA QA CENTER — tipo_proyecto en qa_center.projects
--
-- Diferencia: 'erp' usa SOLO <a href> para descubrir modulos (comportamiento
-- original, probado con Mevo/Villa Hayes/Diemart). 'web' habilita ademas la
-- detección de tabs/botones SPA (click-text), necesaria para paneles admin
-- como Rincon Alpino. Default 'erp' preserva el comportamiento de los
-- proyectos existentes sin tocarlos.

ALTER TABLE qa_center.projects
  ADD COLUMN IF NOT EXISTS tipo_proyecto text NOT NULL DEFAULT 'erp'
  CHECK (tipo_proyecto IN ('erp', 'web'));

COMMENT ON COLUMN qa_center.projects.tipo_proyecto IS
  '''erp'' = descubridor clasico <a href>; ''web'' = incluye deteccion SPA (tabs, botones, dropdowns).';
