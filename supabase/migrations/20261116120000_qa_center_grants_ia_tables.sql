-- Fix tardío: las migraciones que crearon las 4 tablas del pipeline IA
-- (erp_discoveries, generated_specs, ai_usage, informes_ia) no otorgaron
-- permisos al role `qa_center_api` usado por los endpoints
-- /api/qa/runner/discovery y /api/qa/runner/findings.
--
-- Resultado observado: el pipeline IA corría completo (26 min, ~USD 2
-- gastados con Claude Haiku), pero el POST final del runner contra
-- /api/qa/runner/discovery respondía 500 con
-- "permission denied for table erp_discoveries", nada se persistía,
-- y la UI mostraba "Todavía no hay resultados reportados".
--
-- Idempotente: GRANT no falla si el grant ya existe.

GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.erp_discoveries TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.generated_specs  TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.ai_usage         TO qa_center_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON qa_center.informes_ia      TO qa_center_api;

-- Por si alguna sequence de qa_center apareció sin USAGE para la role.
DO $$
DECLARE s text;
BEGIN
  FOR s IN
    SELECT 'qa_center.'||sequence_name FROM information_schema.sequences
    WHERE sequence_schema='qa_center'
  LOOP
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE '||s||' TO qa_center_api';
  END LOOP;
END$$;
