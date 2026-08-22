-- =============================================================================
-- `primera_entrega_at`: ancla fija de la ventana de cambios gratis post-entrega
--
-- El badge "Día X/30" del Kanban se calculaba desde `estado_actual_desde`, que
-- es genérico y se resetea cada vez que el proyecto cambia de estado —
-- correcto para SLA por estado, pero mal acá: si el proyecto sale de
-- "Entregado" (p. ej. a "Cambios solicitados" para una corrección) y vuelve a
-- entrar, el cliente se ganaba 30 días nuevos de cambios gratis cada vez.
--
-- `primera_entrega_at` se fija UNA sola vez —la primera vez que el proyecto
-- entra a un estado final que no es cancelación— y nunca se vuelve a tocar,
-- ni siquiera si el proyecto sale de ahí y reingresa. El código que la
-- escribe vive en `cambiar-estado`, sólo si la columna todavía es NULL.
--
-- Se replica en todo schema con `proyectos`.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyectos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp', 'neura')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    EXECUTE format(
      'ALTER TABLE %I.proyectos ADD COLUMN IF NOT EXISTS primera_entrega_at timestamptz',
      sch
    );

    RAISE NOTICE 'Schema %: primera_entrega_at lista en proyectos.', sch;
  END LOOP;
END $$;
