-- =============================================================================
-- Hilo de comentarios de QA dividido por origen: QA vs. técnico
--
-- El hilo de comentarios de una observación era un único chat mezclado, sin
-- forma de distinguir de un vistazo "esto lo escribió QA" de "esto lo escribió
-- el programador respondiéndole". Se agrega `origen` para que la UI pueda
-- dibujar dos carriles separados —"Nota de QA" y "Respuesta del técnico"—
-- dentro de la misma observación, reusando el mismo hilo, notificaciones y
-- borrado que ya existían.
--
--   origen   'qa' | 'tecnico'. Default 'qa': los comentarios que ya existían
--            antes de este campo se leen como notas de QA, que es lo que eran
--            en la práctica (el hilo nació pensado para que QA registrara ahí
--            sus hallazgos).
--
-- REQUIERE SER DUEÑO DE LA TABLA. `proyecto_qa_observacion_comentarios`
-- pertenece a `supabase_admin` en esta instancia; se resuelve con
-- `GRANT supabase_admin TO postgres;` (ya aplicado — ver la migración de
-- notificaciones del 2026-08-19). Si falta, se avisa por NOTICE y no se toca
-- nada, para poder reaplicar después sin abortar el resto.
-- =============================================================================

DO $$
DECLARE
  r         RECORD;
  sch       text;
  soy_dueno boolean;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_qa_observacion_comentarios'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    SELECT pg_get_userbyid(c.relowner) = current_user INTO soy_dueno
    FROM pg_class c
    WHERE c.oid = format('%I.proyecto_qa_observacion_comentarios', sch)::regclass;

    IF NOT COALESCE(soy_dueno, false) THEN
      RAISE NOTICE
        'Schema %: proyecto_qa_observacion_comentarios pertenece a otro rol; origen queda sin agregar. Ejecutá "GRANT supabase_admin TO postgres;" como superusuario y volvé a aplicar esta migración.',
        sch;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.proyecto_qa_observacion_comentarios ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT ''qa''',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.proyecto_qa_observacion_comentarios DROP CONSTRAINT IF EXISTS chk_pqoc_origen',
      sch
    );
    EXECUTE format(
      $sql$ALTER TABLE %I.proyecto_qa_observacion_comentarios ADD CONSTRAINT chk_pqoc_origen CHECK (origen IN ('qa', 'tecnico'))$sql$,
      sch
    );

    RAISE NOTICE 'Schema %: origen listo en proyecto_qa_observacion_comentarios.', sch;
  END LOOP;
END $$;
