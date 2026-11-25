-- Cuando un usuario se da de baja (estado deja de ser 'activo'), se libera solo de:
--   · el organigrama: su puesto queda vacante (sin persona ni usuario vinculado);
--   · las guardias de esta semana en adelante: su lugar queda sin asignar.
-- Las guardias pasadas no se tocan: son historia.
CREATE OR REPLACE FUNCTION neura.liberar_usuario_dado_de_baja(p_usuario uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = neura, public AS $$
DECLARE
  s text;
  lunes date := (date_trunc('week', (now() AT TIME ZONE 'America/Asuncion')))::date;
BEGIN
  FOR s IN SELECT table_schema FROM information_schema.columns
           WHERE table_name = 'organigrama_nodos' AND column_name = 'usuario_id'
  LOOP
    EXECUTE format('UPDATE %I.organigrama_nodos SET usuario_id = NULL, nombre_persona = NULL, foto_url = NULL, updated_at = now() WHERE usuario_id = $1', s)
      USING p_usuario;
  END LOOP;

  FOR s IN SELECT table_schema FROM information_schema.tables WHERE table_name = 'guardias_semana'
  LOOP
    EXECUTE format($q$
      UPDATE %I.guardias_semana SET
        pm_id = CASE WHEN pm_id = $1 THEN NULL ELSE pm_id END,
        soporte_principal_id = CASE WHEN soporte_principal_id = $1 THEN NULL ELSE soporte_principal_id END,
        soporte_suplente_id = CASE WHEN soporte_suplente_id = $1 THEN NULL ELSE soporte_suplente_id END,
        updated_at = now()
      WHERE semana_inicio >= $2 AND $1 IN (pm_id, soporte_principal_id, soporte_suplente_id)
    $q$, s) USING p_usuario, lunes;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION neura.usuarios_al_dar_de_baja() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF lower(coalesce(NEW.estado, '')) <> 'activo' AND lower(coalesce(OLD.estado, '')) = 'activo' THEN
    PERFORM neura.liberar_usuario_dado_de_baja(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_usuarios_al_dar_de_baja ON neura.usuarios;
CREATE TRIGGER trg_usuarios_al_dar_de_baja
  AFTER UPDATE OF estado ON neura.usuarios
  FOR EACH ROW EXECUTE FUNCTION neura.usuarios_al_dar_de_baja();

