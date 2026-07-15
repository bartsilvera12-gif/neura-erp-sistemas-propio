-- =============================================================================
-- Fix duplicados de campaña: CLAIM ATÓMICO de destinatarios (FOR UPDATE SKIP LOCKED)
-- =============================================================================
-- Antes, el despachador hacía SELECT ... WHERE status='queued' y luego un UPDATE a
-- ciegas a 'sending'. Con ejecuciones concurrentes (poll de navegador cada 4s, varias
-- pestañas/usuarios) dos procesos leían el MISMO lote y ambos enviaban → duplicados
-- (hasta 10 mensajes al mismo número).
--
-- Esta función reclama hasta N destinatarios 'queued' y los pasa a 'sending' de forma
-- atómica, bloqueando las filas con FOR UPDATE SKIP LOCKED: procesos concurrentes
-- obtienen conjuntos DISJUNTOS y nunca el mismo destinatario. Devuelve solo las filas
-- que ESTE proceso reclamó.
-- =============================================================================

DO $migration$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_campaign_recipients' AND c.relkind = 'r'
      -- Alcance: solo el tenant `neura` (single_client). Otros tenants aplican su
      -- propia migración con su rol dueño del schema.
      AND n.nspname IN ('neura')
  LOOP
    EXECUTE format($fn$
      CREATE OR REPLACE FUNCTION %I.claim_campaign_recipients(
        p_empresa_id uuid,
        p_campaign_id uuid,
        p_batch_size int
      )
      RETURNS SETOF %I.chat_campaign_recipients
      LANGUAGE sql
      AS $body$
        WITH claimed AS (
          SELECT id
          FROM %I.chat_campaign_recipients
          WHERE empresa_id = p_empresa_id
            AND campaign_id = p_campaign_id
            AND status = 'queued'
          ORDER BY row_number ASC
          FOR UPDATE SKIP LOCKED
          LIMIT GREATEST(1, LEAST(100, p_batch_size))
        )
        UPDATE %I.chat_campaign_recipients r
        SET status = 'sending', updated_at = now()
        FROM claimed
        WHERE r.id = claimed.id
        RETURNING r.*;
      $body$;
    $fn$, sch, sch, sch, sch);
  END LOOP;
END
$migration$;
