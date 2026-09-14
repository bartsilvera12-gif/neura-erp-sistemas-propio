-- =============================================================================
-- Módulo Soporte — tickets, trazabilidad y catálogos
--
-- Aditiva e idempotente: sólo crea lo que falta. No toca tablas existentes.
--
-- Convenciones del repositorio que se respetan:
--   · Una copia por schema de empresa (multi-schema), con `empresa_id` en cada
--     fila, igual que `proyecto_*` y `proyecto_qa_*`.
--   · UUIDs como clave.
--   · Catálogos por empresa (`soporte_estados`, …) con `codigo` estable,
--     `nombre` editable, `sort_order` y `activo`, como `proyecto_estados`.
--
-- Seguridad:
--   · RLS activo y SIN políticas, y sin permisos para `anon` ni `authenticated`.
--     Toda lectura y escritura pasa por la API con service role, que es la que
--     aplica el permiso de rol. Nadie puede leer tickets de otra empresa
--     consultando PostgREST directo con su token.
--   · El historial es sólo-inserción A NIVEL BASE: no se le otorga UPDATE ni
--     DELETE a nadie. Actualizar un ticket no puede destruir su trazabilidad
--     aunque un bug lo intente.
--
-- Los catálogos no se siembran acá: la API los crea por empresa la primera vez
-- que se usa el módulo (`asegurarCatalogosSoporte`). Sembrar desde SQL exigiría
-- adivinar qué empresas viven en cada schema.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  s text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_namespace n
    WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = 'clientes'  AND c.relkind = 'r')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = 'proyectos' AND c.relkind = 'r')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND c.relname = 'empresas'  AND c.relkind = 'r')
    ORDER BY 1
  LOOP
    s := r.sch;

    -- ------------------------------------------------------------ catálogos
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_estados (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id   uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
        codigo       text NOT NULL,
        nombre       text NOT NULL,
        -- Abierto / cerrado: lo que cuenta como "pendiente" en tableros y KPIs.
        tipo         text NOT NULL DEFAULT 'abierto' CHECK (tipo IN ('abierto','cerrado')),
        color        text NOT NULL DEFAULT '#94a3b8',
        -- Quién suele tener la próxima acción en este estado (ATC/PM, Desarrollo, QA).
        area         text,
        -- Al entrar a este estado el reloj del SLA se detiene.
        detiene_sla  boolean NOT NULL DEFAULT false,
        es_inicial   boolean NOT NULL DEFAULT false,
        sort_order   integer NOT NULL DEFAULT 0,
        activo       boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_soporte_estados_codigo UNIQUE (empresa_id, codigo)
      )$f$, s, s);

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_tipos (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id   uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
        codigo       text NOT NULL,
        nombre       text NOT NULL,
        -- SLA cuando el tipo no tiene clasificaciones (consulta, capacitación…).
        sla_horas    numeric(8,2),
        sort_order   integer NOT NULL DEFAULT 0,
        activo       boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_soporte_tipos_codigo UNIQUE (empresa_id, codigo)
      )$f$, s, s);

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_clasificaciones (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id         uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
        codigo             text NOT NULL,
        tipo_codigo        text NOT NULL,
        nombre             text NOT NULL,
        -- Service level del proceso oficial de Gestión de Soporte.
        sla_horas          numeric(8,2) NOT NULL,
        prioridad_sugerida text,
        sort_order         integer NOT NULL DEFAULT 0,
        activo             boolean NOT NULL DEFAULT true,
        created_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_soporte_clasificaciones_codigo UNIQUE (empresa_id, codigo)
      )$f$, s, s);

    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_prioridades (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id   uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
        codigo       text NOT NULL,
        nombre       text NOT NULL,
        color        text NOT NULL DEFAULT '#94a3b8',
        sort_order   integer NOT NULL DEFAULT 0,
        activo       boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_soporte_prioridades_codigo UNIQUE (empresa_id, codigo)
      )$f$, s, s);

    -- --------------------------------------------------------------- tickets
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_tickets (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id            uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
        -- Número visible (#1042), correlativo por empresa. Lo asigna el trigger.
        numero                integer NOT NULL,
        asunto                text NOT NULL CHECK (length(btrim(asunto)) > 0),
        descripcion           text NOT NULL,
        resultado_esperado    text,
        impacto_operativo     text,
        pasos_reproducir      text,
        criterios_aceptacion  text,
        -- Vínculo con entidades existentes: no se duplican clientes ni proyectos.
        cliente_id            uuid REFERENCES %I.clientes(id) ON DELETE SET NULL,
        proyecto_id           uuid REFERENCES %I.proyectos(id) ON DELETE SET NULL,
        modulo                text,
        version               text,
        entorno               text,
        navegador             text,
        tipo_codigo           text NOT NULL,
        clasificacion_codigo  text,
        prioridad_codigo      text NOT NULL,
        estado_codigo         text NOT NULL,
        -- Quién tiene la PRÓXIMA ACCIÓN. Usuario del catálogo (sin FK: el
        -- catálogo de usuarios puede vivir en otro schema).
        responsable_id        uuid,
        proxima_accion        text,
        -- SLA congelado al crear/clasificar: cambiar la configuración después no
        -- reescribe los compromisos ya tomados.
        sla_horas             numeric(8,2),
        fecha_objetivo        date,
        resuelto_at           timestamptz,
        cerrado_at            timestamptz,
        created_by            uuid,
        updated_by            uuid,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_soporte_tickets_numero UNIQUE (empresa_id, numero)
      )$f$, s, s, s, s);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_tickets (empresa_id, estado_codigo)',
      'ix_sop_tk_estado_' || md5(s), s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_tickets (empresa_id, responsable_id)',
      'ix_sop_tk_resp_' || md5(s), s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_tickets (empresa_id, cliente_id)',
      'ix_sop_tk_cli_' || md5(s), s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_tickets (empresa_id, updated_at DESC)',
      'ix_sop_tk_upd_' || md5(s), s);

    -- Numeración correlativa por empresa. El lock transaccional por empresa
    -- evita que dos altas simultáneas tomen el mismo número.
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION %I.soporte_tickets_asignar_numero()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = %I, pg_temp
      AS $body$
      BEGIN
        IF NEW.numero IS NULL OR NEW.numero <= 0 THEN
          PERFORM pg_advisory_xact_lock(hashtext('soporte_tickets:' || NEW.empresa_id::text));
          SELECT COALESCE(MAX(numero), 1000) + 1 INTO NEW.numero
          FROM soporte_tickets WHERE empresa_id = NEW.empresa_id;
        END IF;
        RETURN NEW;
      END
      $body$
    $f$, s, s);

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgname = 'trg_soporte_tickets_numero'
        AND t.tgrelid = format('%I.soporte_tickets', s)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_soporte_tickets_numero BEFORE INSERT ON %I.soporte_tickets
           FOR EACH ROW EXECUTE FUNCTION %I.soporte_tickets_asignar_numero()', s, s);
    END IF;

    -- ------------------------------------------------------------ comentarios
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_ticket_comentarios (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id    uuid NOT NULL,
        ticket_id     uuid NOT NULL REFERENCES %I.soporte_tickets(id) ON DELETE CASCADE,
        usuario_id    uuid,
        contenido     text NOT NULL CHECK (length(btrim(contenido)) > 0),
        -- QA devolvió el ticket: la vista lo destaca en rojo suave.
        es_rechazo_qa boolean NOT NULL DEFAULT false,
        created_at    timestamptz NOT NULL DEFAULT now()
      )$f$, s, s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_ticket_comentarios (ticket_id, created_at)',
      'ix_sop_com_tk_' || md5(s), s);

    -- --------------------------------------------------------------- archivos
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_ticket_archivos (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id     uuid NOT NULL,
        ticket_id      uuid NOT NULL REFERENCES %I.soporte_tickets(id) ON DELETE CASCADE,
        comentario_id  uuid REFERENCES %I.soporte_ticket_comentarios(id) ON DELETE SET NULL,
        nombre         text NOT NULL,
        descripcion    text,
        -- El archivo vive en Storage; acá sólo la referencia.
        storage_bucket text NOT NULL,
        storage_path   text NOT NULL,
        mime_type      text,
        size_bytes     bigint,
        subido_por     uuid,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_soporte_archivos_path UNIQUE (storage_bucket, storage_path)
      )$f$, s, s, s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_ticket_archivos (ticket_id, created_at)',
      'ix_sop_arch_tk_' || md5(s), s);

    -- -------------------------------------------------------------- historial
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_ticket_historial (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id      uuid NOT NULL,
        ticket_id       uuid NOT NULL REFERENCES %I.soporte_tickets(id) ON DELETE CASCADE,
        tipo_evento     text NOT NULL,
        usuario_id      uuid,
        valor_anterior  text,
        valor_nuevo     text,
        metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at      timestamptz NOT NULL DEFAULT now()
      )$f$, s, s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_ticket_historial (ticket_id, created_at)',
      'ix_sop_hist_tk_' || md5(s), s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.soporte_ticket_historial (empresa_id, tipo_evento, created_at)',
      'ix_sop_hist_ev_' || md5(s), s);

    -- ------------------------------------------------------------- relaciones
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.soporte_ticket_relaciones (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id             uuid NOT NULL,
        ticket_id              uuid NOT NULL REFERENCES %I.soporte_tickets(id) ON DELETE CASCADE,
        ticket_relacionado_id  uuid NOT NULL REFERENCES %I.soporte_tickets(id) ON DELETE CASCADE,
        tipo                   text NOT NULL DEFAULT 'relacionado'
          CHECK (tipo IN ('relacionado','duplicado_de','bloquea','bloqueado_por','deriva_de')),
        created_by             uuid,
        created_at             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_soporte_relacion_distinta CHECK (ticket_id <> ticket_relacionado_id),
        CONSTRAINT uq_soporte_relacion UNIQUE (ticket_id, ticket_relacionado_id, tipo)
      )$f$, s, s, s);

    -- --------------------------------------------------------------- permisos
    EXECUTE format($f$
      ALTER TABLE %1$I.soporte_estados            ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %1$I.soporte_tipos              ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %1$I.soporte_clasificaciones    ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %1$I.soporte_prioridades        ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %1$I.soporte_tickets            ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %1$I.soporte_ticket_comentarios ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %1$I.soporte_ticket_archivos    ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %1$I.soporte_ticket_historial   ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %1$I.soporte_ticket_relaciones  ENABLE ROW LEVEL SECURITY;

      REVOKE ALL ON %1$I.soporte_estados, %1$I.soporte_tipos, %1$I.soporte_clasificaciones,
                    %1$I.soporte_prioridades, %1$I.soporte_tickets, %1$I.soporte_ticket_comentarios,
                    %1$I.soporte_ticket_archivos, %1$I.soporte_ticket_historial,
                    %1$I.soporte_ticket_relaciones
        FROM anon, authenticated;

      GRANT SELECT, INSERT, UPDATE, DELETE ON
        %1$I.soporte_estados, %1$I.soporte_tipos, %1$I.soporte_clasificaciones,
        %1$I.soporte_prioridades, %1$I.soporte_tickets, %1$I.soporte_ticket_comentarios,
        %1$I.soporte_ticket_archivos, %1$I.soporte_ticket_relaciones
        TO service_role;

      -- Historial: sólo leer y agregar. Nunca editar ni borrar.
      REVOKE UPDATE, DELETE, TRUNCATE ON %1$I.soporte_ticket_historial FROM service_role;
      GRANT SELECT, INSERT ON %1$I.soporte_ticket_historial TO service_role;
    $f$, s);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
