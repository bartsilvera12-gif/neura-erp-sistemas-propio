-- Tipificación de cliente → ticket de Soporte.
--
-- La tipificación es el origen de la interacción con el cliente; el ticket es
-- el objeto que trabajan Soporte, Desarrollo y QA. No se crea otro sistema:
-- se vinculan las tablas que ya existen.
--
--   · tipificaciones.tipo_gestion admite 'Error'.
--   · tipificaciones.usuario_id: el usuario autenticado real (catálogo). La
--     columna `usuario` (texto) se conserva y se sigue llenando con su nombre.
--   · soporte_tickets.origen / tipificacion_id: el ticket conoce su origen. La
--     tipificación conoce su ticket por la inversa (índice único): una sola
--     fuente de verdad, sin dos columnas que mantener sincronizadas.
--   · soporte_crear_ticket_desde_tipificacion(): inserta tipificación y ticket
--     en UNA transacción. Nunca queda una sin la otra.
--
-- Aditiva e idempotente. Sólo en schemas que ya tienen Soporte y tipificaciones.
-- Las credenciales del proyecto NO se copian a ningún lado: el ticket guarda
-- proyecto_id y se resuelven desde proyecto_credenciales al consultarlas.

SET client_encoding = 'UTF8';

DO $mig$
DECLARE
  s text;
  permitidos text;
BEGIN
  -- 1 y 2 van en TODOS los schemas con tipificaciones (hay alguno sin Soporte):
  -- el alta normal escribe usuario_id y no puede fallar por la columna.
  FOR s IN
    SELECT n.nspname
    FROM pg_namespace n
    WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r' AND c.relname = 'tipificaciones')
    ORDER BY 1
  LOOP
    -- 1. Usuario real de la tipificación.
    EXECUTE format('ALTER TABLE %I.tipificaciones ADD COLUMN IF NOT EXISTS usuario_id uuid', s);

    -- 2. Tipo 'Error'. La lista nueva = la oficial + Error + cualquier valor que
    --    ya exista en la tabla (así el CHECK nunca invalida filas viejas).
    --    Escapes Unicode para no depender del encoding del cliente psql.
    EXECUTE format($q$
      SELECT string_agg(quote_literal(v), ', ' ORDER BY v)
      FROM (
        SELECT unnest(ARRAY['Consulta', 'Reclamo', 'Seguimiento', 'Promesa de pago',
                            U&'Soporte t\00E9cnico', 'Cambio plan', 'Error']) AS v
        UNION
        SELECT DISTINCT tipo_gestion FROM %I.tipificaciones
      ) x
    $q$, s) INTO permitidos;
    EXECUTE format('ALTER TABLE %I.tipificaciones DROP CONSTRAINT IF EXISTS tipificaciones_tipo_gestion_check', s);
    EXECUTE format('ALTER TABLE %I.tipificaciones ADD CONSTRAINT tipificaciones_tipo_gestion_check CHECK (tipo_gestion IN (%s))', s, permitidos);

  END LOOP;

  FOR s IN
    SELECT n.nspname
    FROM pg_namespace n
    WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r' AND c.relname = 'soporte_tickets')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r' AND c.relname = 'tipificaciones')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r' AND c.relname = 'proyectos')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'r' AND c.relname = 'clientes')
    ORDER BY 1
  LOOP
    -- 3. Origen del ticket.
    EXECUTE format('ALTER TABLE %I.soporte_tickets ADD COLUMN IF NOT EXISTS origen text', s);
    EXECUTE format('ALTER TABLE %I.soporte_tickets ADD COLUMN IF NOT EXISTS tipificacion_id uuid', s);
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = s AND t.relname = 'soporte_tickets' AND c.conname = 'soporte_tickets_tipificacion_fk'
    ) THEN
      EXECUTE format('ALTER TABLE %I.soporte_tickets ADD CONSTRAINT soporte_tickets_tipificacion_fk
        FOREIGN KEY (tipificacion_id) REFERENCES %I.tipificaciones(id) ON DELETE SET NULL', s, s);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = s AND t.relname = 'soporte_tickets' AND c.conname = 'soporte_tickets_origen_check'
    ) THEN
      EXECUTE format($q$ALTER TABLE %I.soporte_tickets ADD CONSTRAINT soporte_tickets_origen_check
        CHECK (origen IS NULL OR origen IN ('manual', 'tipificacion_cliente'))$q$, s);
    END IF;
    -- Una tipificación genera como máximo un ticket.
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.soporte_tickets (tipificacion_id) WHERE tipificacion_id IS NOT NULL',
      'ux_sop_tk_tipif_' || md5(s), s);

    -- 4. Alta atómica. SECURITY INVOKER: corre con los permisos de quien llama
    --    (la API, con service role). Nadie más la puede ejecutar.
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION %I.soporte_crear_ticket_desde_tipificacion(p_tipificacion jsonb, p_ticket jsonb)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = %I, pg_temp
      AS $body$
      DECLARE
        v_emp uuid := NULLIF(p_tipificacion->>'empresa_id', '')::uuid;
        v_cli uuid := NULLIF(p_tipificacion->>'cliente_id', '')::uuid;
        v_pro uuid := NULLIF(p_ticket->>'proyecto_id', '')::uuid;
        v_tip uuid;
        v_tk uuid;
        v_num integer;
      BEGIN
        IF v_emp IS NULL OR v_cli IS NULL THEN
          RAISE EXCEPTION 'Empresa y cliente son obligatorios' USING ERRCODE = '22023';
        END IF;
        -- El ticket no puede apuntar a otra empresa ni a otro cliente que la tipificación.
        IF NULLIF(p_ticket->>'empresa_id', '')::uuid IS DISTINCT FROM v_emp
           OR NULLIF(p_ticket->>'cliente_id', '')::uuid IS DISTINCT FROM v_cli THEN
          RAISE EXCEPTION 'El ticket y la tipificación deben ser del mismo cliente' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = v_cli AND empresa_id = v_emp) THEN
          RAISE EXCEPTION 'El cliente no pertenece a la empresa' USING ERRCODE = '22023';
        END IF;
        IF v_pro IS NULL OR NOT EXISTS (
          SELECT 1 FROM proyectos WHERE id = v_pro AND cliente_id = v_cli AND empresa_id = v_emp
        ) THEN
          RAISE EXCEPTION 'El proyecto no pertenece a ese cliente' USING ERRCODE = '22023';
        END IF;

        INSERT INTO tipificaciones (empresa_id, cliente_id, usuario, usuario_id, tipo_gestion, resultado, observacion)
        VALUES (
          v_emp, v_cli,
          p_tipificacion->>'usuario',
          NULLIF(p_tipificacion->>'usuario_id', '')::uuid,
          p_tipificacion->>'tipo_gestion',
          p_tipificacion->>'resultado',
          p_tipificacion->>'observacion'
        )
        RETURNING id INTO v_tip;

        INSERT INTO soporte_tickets (
          empresa_id, numero, asunto, descripcion, resultado_esperado, impacto_operativo,
          pasos_reproducir, criterios_aceptacion, cliente_id, proyecto_id, modulo, version,
          entorno, navegador, tipo_codigo, clasificacion_codigo, prioridad_codigo, estado_codigo,
          responsable_id, proxima_accion, sla_horas, fecha_objetivo, created_by, updated_by,
          origen, tipificacion_id
        ) VALUES (
          v_emp, 0,
          p_ticket->>'asunto',
          p_ticket->>'descripcion',
          p_ticket->>'resultado_esperado',
          p_ticket->>'impacto_operativo',
          p_ticket->>'pasos_reproducir',
          p_ticket->>'criterios_aceptacion',
          v_cli, v_pro,
          p_ticket->>'modulo',
          p_ticket->>'version',
          p_ticket->>'entorno',
          p_ticket->>'navegador',
          p_ticket->>'tipo_codigo',
          p_ticket->>'clasificacion_codigo',
          p_ticket->>'prioridad_codigo',
          p_ticket->>'estado_codigo',
          NULLIF(p_ticket->>'responsable_id', '')::uuid,
          p_ticket->>'proxima_accion',
          NULLIF(p_ticket->>'sla_horas', '')::numeric,
          NULLIF(p_ticket->>'fecha_objetivo', '')::date,
          NULLIF(p_ticket->>'created_by', '')::uuid,
          NULLIF(p_ticket->>'updated_by', '')::uuid,
          'tipificacion_cliente', v_tip
        )
        RETURNING id, numero INTO v_tk, v_num;

        RETURN jsonb_build_object('tipificacion_id', v_tip, 'ticket_id', v_tk, 'numero', v_num);
      END
      $body$
    $f$, s, s);

    EXECUTE format('REVOKE ALL ON FUNCTION %I.soporte_crear_ticket_desde_tipificacion(jsonb, jsonb) FROM PUBLIC, anon, authenticated', s);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.soporte_crear_ticket_desde_tipificacion(jsonb, jsonb) TO service_role', s);
  END LOOP;
END
$mig$;

NOTIFY pgrst, 'reload schema';
