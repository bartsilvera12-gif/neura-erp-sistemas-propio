-- =============================================================================
-- Soporte: nuevo flujo de estados y subtareas de revisión QA
--
-- Estados del ticket:
--   Pendiente → En proceso / Falta información / Cancelado
--   En proceso → Cancelado / Falta información / Listo para revisión
--   Listo para revisión → (se crea una subtarea de revisión para QA)
--     · QA pide cambios → Re-abierto
--     · subtareas finalizadas → Resuelto
--   Resuelto → Re-abierto / Cerrado
--   Cerrado: final.
--
-- Subtareas: Pendiente, En proceso, Cambios solicitados, Finalizado.
--
-- Aditiva e idempotente:
--   · crea `soporte_subtareas` y agrega `subtarea_id` a los comentarios;
--   · en los catálogos ya sembrados agrega los estados nuevos, pasa los
--     tickets al estado equivalente y retira SOLO los códigos del flujo viejo
--     (registrado, clasificado, en_desarrollo, en_qa, con_observaciones);
--   · amplía el CHECK de `usuario_notificaciones` con 'soporte_revision'.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

DO $$
DECLARE
  r RECORD;
  s text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_namespace n
    WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = 'soporte_tickets' AND c.relkind = 'r')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = 'soporte_estados' AND c.relkind = 'r')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = 'soporte_ticket_comentarios' AND c.relkind = 'r')
    ORDER BY 1
  LOOP
    s := r.sch;

    -- ------------------------------------------------------------ subtareas
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_subtareas (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id     uuid NOT NULL,
        ticket_id      uuid NOT NULL REFERENCES %I.soporte_tickets(id) ON DELETE CASCADE,
        -- Correlativo dentro del ticket: "Revisión QA #2" es la segunda vuelta.
        numero         integer NOT NULL,
        tipo           text NOT NULL DEFAULT 'revision_qa',
        titulo         text NOT NULL,
        estado         text NOT NULL DEFAULT 'pendiente'
          CHECK (estado IN ('pendiente','en_proceso','cambios_solicitados','finalizado')),
        asignado_id    uuid,
        created_by     uuid,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        finalizado_at  timestamptz,
        CONSTRAINT uq_soporte_subtareas_numero UNIQUE (ticket_id, numero)
      )$f$, s, s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_subtareas (empresa_id, asignado_id, estado)',
      'ix_sop_sub_asig_' || md5(s), s);

    EXECUTE format('ALTER TABLE %I.soporte_subtareas ENABLE ROW LEVEL SECURITY', s);
    EXECUTE format('REVOKE ALL ON %I.soporte_subtareas FROM anon, authenticated', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.soporte_subtareas TO service_role', s);

    -- Comentarios de una subtarea: la misma tabla, marcados con su subtarea.
    EXECUTE format(
      'ALTER TABLE %I.soporte_ticket_comentarios ADD COLUMN IF NOT EXISTS subtarea_id uuid REFERENCES %I.soporte_subtareas(id) ON DELETE CASCADE',
      s, s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_ticket_comentarios (subtarea_id, created_at) WHERE subtarea_id IS NOT NULL',
      'ix_sop_com_sub_' || md5(s), s);

    -- ------------------------------------------------- estados (ya sembrados)
    EXECUTE format($f$
      INSERT INTO %1$I.soporte_estados (empresa_id, codigo, nombre, tipo, color, area, detiene_sla, es_inicial, sort_order, activo)
      SELECT e.empresa_id, v.codigo, v.nombre, v.tipo, v.color, v.area, v.detiene_sla, v.es_inicial, v.sort_order, true
      FROM (SELECT DISTINCT empresa_id FROM %1$I.soporte_estados) e
      CROSS JOIN (VALUES
        ('pendiente',         'Pendiente',              'abierto', '#94a3b8', 'ATC / PM',   false, true,  1),
        ('en_proceso',        'En proceso',             'abierto', '#0ea5e9', 'Desarrollo', false, false, 2),
        ('falta_informacion', U&'Falta informaci\00F3n', 'abierto', '#f59e0b', 'ATC / PM',   false, false, 3),
        ('listo_revision',    U&'Listo para revisi\00F3n','abierto', '#8b5cf6', 'QA',         false, false, 4),
        ('reabierto',         'Re-abierto',             'abierto', '#f97316', 'Desarrollo', false, false, 5),
        ('resuelto',          'Resuelto',               'cerrado', '#10b981', 'ATC / PM',   true,  false, 6),
        ('cancelado',         'Cancelado',              'cerrado', '#f43f5e', NULL,         true,  false, 7),
        ('cerrado',           'Cerrado',                'cerrado', '#334155', NULL,         true,  false, 8)
      ) AS v(codigo, nombre, tipo, color, area, detiene_sla, es_inicial, sort_order)
      ON CONFLICT (empresa_id, codigo) DO NOTHING
    $f$, s);

    -- Resuelto y Cerrado existían: toman el nombre y el orden del flujo nuevo.
    EXECUTE format($f$
      UPDATE %1$I.soporte_estados SET nombre = 'Resuelto', sort_order = 6, es_inicial = false
       WHERE codigo = 'resuelto' AND nombre <> 'Resuelto';
      UPDATE %1$I.soporte_estados SET nombre = 'Cerrado', sort_order = 8, area = NULL, es_inicial = false
       WHERE codigo = 'cerrado' AND nombre <> 'Cerrado';
    $f$, s);

    -- Tickets al estado equivalente del flujo nuevo.
    EXECUTE format($f$
      UPDATE %1$I.soporte_tickets SET estado_codigo = CASE estado_codigo
          WHEN 'registrado' THEN 'pendiente'
          WHEN 'clasificado' THEN 'pendiente'
          WHEN 'en_desarrollo' THEN 'en_proceso'
          WHEN 'con_observaciones' THEN 'reabierto'
          WHEN 'en_qa' THEN 'listo_revision'
        END
       WHERE estado_codigo IN ('registrado','clasificado','en_desarrollo','con_observaciones','en_qa')
    $f$, s);

    -- Sólo los códigos del flujo viejo, y sólo si ya nadie los usa.
    EXECUTE format($f$
      DELETE FROM %1$I.soporte_estados e
       WHERE e.codigo IN ('registrado','clasificado','en_desarrollo','en_qa','con_observaciones')
         AND NOT EXISTS (SELECT 1 FROM %1$I.soporte_tickets t
                          WHERE t.empresa_id = e.empresa_id AND t.estado_codigo = e.codigo)
    $f$, s);
  END LOOP;
END $$;

-- ----------------------------------------------------- aviso en la campanita
SET ROLE supabase_admin;

DO $$
DECLARE
  r   RECORD;
  sch text;
  def text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'usuario_notificaciones' AND c.relkind = 'r'
    ORDER BY 1
  LOOP
    sch := r.sch;
    SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
    WHERE conname = 'chk_unotif_tipo'
      AND conrelid = format('%I.usuario_notificaciones', sch)::regclass;

    CONTINUE WHEN def IS NULL OR def LIKE '%soporte_revision%';

    EXECUTE format('ALTER TABLE %I.usuario_notificaciones DROP CONSTRAINT chk_unotif_tipo', sch);
    EXECUTE format(
      $c$ALTER TABLE %I.usuario_notificaciones
         ADD CONSTRAINT chk_unotif_tipo CHECK (tipo = ANY (ARRAY[
           'qa_novedad', 'qa_aprobado', 'qa_rechazado',
           'proyecto_estado_cambio', 'proyecto_entregado',
           'cobro_pendiente', 'comentario_proyecto',
           'chat_interno_mensaje', 'conversacion_asignada',
           'conversacion_mensaje', 'soporte_revision'
         ]))$c$,
      sch);
  END LOOP;
END $$;

RESET ROLE;

NOTIFY pgrst, 'reload schema';
