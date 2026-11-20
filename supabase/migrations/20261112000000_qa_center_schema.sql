-- =============================================================================
-- NEURA QA CENTER · Fase 1 — esquema aislado
-- -----------------------------------------------------------------------------
-- Aditiva y NO INVASIVA:
--   · Crea un esquema nuevo `qa_center`, independiente de `neura`, `zentra_erp`
--     y de cualquier `erp_*` tenant. No altera tablas, funciones, triggers,
--     policies ni roles existentes.
--   · Idempotente (`IF NOT EXISTS`, `DO` blocks con guardas).
--   · Tablas solo-API: RLS activa + sin policies para `anon` / `authenticated`;
--     GRANT solo a `service_role` (misma convención que `personal_*`).
--   · Reversible: `DROP SCHEMA qa_center CASCADE;` elimina únicamente lo creado
--     por esta migración.
--   · NO se expone al API de PostgREST hasta que `qa_center` se agregue a
--     `supabase/config.toml :: [api].schemas` y se recargue el stack. Esa
--     acción es manual y queda fuera de esta migración.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout    = '5s';

-- ──────────────────────────────── esquema ────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS qa_center;
COMMENT ON SCHEMA qa_center IS
  'NEURA QA CENTER — panel y motor de QA Desarrollo. Aislado de datos de clientes.';

REVOKE ALL      ON SCHEMA qa_center FROM PUBLIC;
GRANT  USAGE    ON SCHEMA qa_center TO service_role;
-- `authenticated` solo obtiene USAGE cuando se agreguen policies finas (fase 2).

-- ──────────────────────────────── enums ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE qa_center.run_status AS ENUM (
    'queued', 'running', 'passed', 'failed', 'aborted', 'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE qa_center.finding_severity AS ENUM (
    'blocker', 'critical', 'major', 'minor', 'info'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE qa_center.finding_status AS ENUM (
    'open', 'triaged', 'confirmed', 'wont_fix', 'fixed', 'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Deliberadamente no incluye 'production': el runner aborta si el target responde prod.
  CREATE TYPE qa_center.target_env AS ENUM ('staging', 'preview', 'local');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ──────────────────────────────── tablas ─────────────────────────────────────

-- Un proyecto = un ERP bajo QA (ej. sistemas-propio, mevo, mevo-vendedores).
CREATE TABLE IF NOT EXISTS qa_center.projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  repo_url        text,
  default_branch  text NOT NULL DEFAULT 'main',
  target_base_url text NOT NULL,
  target_env      qa_center.target_env NOT NULL DEFAULT 'staging',
  owner_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_qa_projects_slug
  ON qa_center.projects(slug) WHERE archived_at IS NULL;

-- Suite = colección lógica de specs Playwright (versionados en el repo del runner).
-- `specs` es la lista blanca de archivos permitidos por este suite. Si llega un
-- reporte de un spec que no está en esta lista, el handler lo rechaza como
-- `spec_not_authorized` (defensa contra ejecución de código ajeno al suite).
CREATE TABLE IF NOT EXISTS qa_center.suites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES qa_center.projects(id) ON DELETE CASCADE,
  slug         text NOT NULL,
  name         text NOT NULL,
  description  text,
  tags         text[] NOT NULL DEFAULT '{}'::text[],
  specs        text[] NOT NULL DEFAULT '{}'::text[],
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug),
  CONSTRAINT chk_specs_nonempty CHECK (
    array_length(specs, 1) IS NULL OR array_length(specs, 1) >= 0
  )
);
-- Guarda compatibilidad con instalaciones donde la tabla ya existió sin `specs`.
ALTER TABLE qa_center.suites ADD COLUMN IF NOT EXISTS specs text[] NOT NULL DEFAULT '{}'::text[];

-- Ejecución completa de un suite contra un target.
CREATE TABLE IF NOT EXISTS qa_center.runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES qa_center.projects(id) ON DELETE RESTRICT,
  suite_id             uuid NOT NULL REFERENCES qa_center.suites(id)   ON DELETE RESTRICT,
  trigger              text NOT NULL CHECK (trigger IN ('manual','webhook_pr','cron','retry')),
  triggered_by_user_id uuid REFERENCES auth.users(id),
  triggered_by_ref     text,
  status               qa_center.run_status NOT NULL DEFAULT 'queued',
  target_base_url      text NOT NULL,
  target_env           qa_center.target_env NOT NULL,
  env_assert_response  jsonb,
  env_assert_passed    boolean,
  playwright_version   text,
  runner_image_digest  text,
  started_at           timestamptz,
  finished_at          timestamptz,
  duration_ms          integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  totals               jsonb NOT NULL DEFAULT
                         '{"passed":0,"failed":0,"skipped":0,"flaky":0}'::jsonb,
  summary              text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_runs_project_time
  ON qa_center.runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_runs_status_active
  ON qa_center.runs(status) WHERE status IN ('queued','running');

-- Resultado por spec dentro de un run.
-- UNIQUE (run_id, spec_file, test_title) hace que la idempotencia sea
-- enforceada por el motor: un `INSERT ... ON CONFLICT DO NOTHING` NO insertará
-- duplicados aún con dos requests concurrentes.
CREATE TABLE IF NOT EXISTS qa_center.results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES qa_center.runs(id) ON DELETE CASCADE,
  spec_file     text NOT NULL,
  test_title    text NOT NULL,
  status        text NOT NULL CHECK (status IN
                  ('passed','failed','skipped','flaky','timed_out')),
  duration_ms   integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  retries       integer NOT NULL DEFAULT 0,
  error_type    text,
  error_message text,
  stack_trace   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_results_run_spec_title UNIQUE (run_id, spec_file, test_title)
);
CREATE INDEX IF NOT EXISTS idx_qa_results_run ON qa_center.results(run_id);

-- Evidencias: screenshots, videos, HAR, trace.zip de Playwright.
CREATE TABLE IF NOT EXISTS qa_center.evidences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES qa_center.runs(id) ON DELETE CASCADE,
  result_id    uuid REFERENCES qa_center.results(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN
                  ('screenshot','video','trace','har','log')),
  storage_path text NOT NULL,
  content_type text,
  size_bytes   bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_evidences_run ON qa_center.evidences(run_id);

-- Hallazgos. `external_ticket_ref` es solo el UUID del ticket de Soporte (si se
-- escala): se guarda como texto para no crear FK cross-schema que acople.
CREATE TABLE IF NOT EXISTS qa_center.findings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES qa_center.projects(id) ON DELETE RESTRICT,
  run_id              uuid REFERENCES qa_center.runs(id)      ON DELETE SET NULL,
  result_id           uuid REFERENCES qa_center.results(id)   ON DELETE SET NULL,
  title               text NOT NULL,
  description         text,
  severity            qa_center.finding_severity NOT NULL DEFAULT 'minor',
  status              qa_center.finding_status   NOT NULL DEFAULT 'open',
  triage_notes        text,
  assigned_user_id    uuid REFERENCES auth.users(id),
  external_ticket_ref text,
  ai_analysis         jsonb,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_findings_status
  ON qa_center.findings(project_id, status, severity);

-- Jobs del runner. Cola simple con `FOR UPDATE SKIP LOCKED`.
CREATE TABLE IF NOT EXISTS qa_center.runner_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL UNIQUE REFERENCES qa_center.runs(id) ON DELETE CASCADE,
  claimed_by    text,
  claimed_at    timestamptz,
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 3,
  heartbeat_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_runner_jobs_unclaimed
  ON qa_center.runner_jobs(created_at) WHERE claimed_at IS NULL;

-- Nonces anti-replay para HMAC del runner.
-- Cada request firmada trae un `X-QA-Nonce` UUIDv4. El servidor hace
-- `INSERT ... ON CONFLICT DO NOTHING` sobre esta tabla. Si no insertó, es un
-- replay. Vidas < ventana skew HMAC (5 min); limpieza periódica por
-- función `cleanup_runner_nonces(interval)`.
CREATE TABLE IF NOT EXISTS qa_center.runner_nonces (
  nonce       text PRIMARY KEY,
  runner_id   text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_nonces_expires
  ON qa_center.runner_nonces(expires_at);

-- Auditoría mínima.
CREATE TABLE IF NOT EXISTS qa_center.audit_log (
  id          bigserial PRIMARY KEY,
  actor       text NOT NULL,
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  payload     jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qa_audit_time ON qa_center.audit_log(created_at DESC);

-- ─────────────────────────────── RLS + grants ────────────────────────────────
-- Patrón del repo: RLS activa, SIN policies, GRANT solo a service_role.
-- La API del ERP usa el cliente de servicio (`service-admin.ts`).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'projects','suites','runs','results','evidences','findings',
    'runner_jobs','audit_log','runner_nonces'
  ]) LOOP
    EXECUTE format('ALTER TABLE qa_center.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE qa_center.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE qa_center.%I TO service_role', t);
  END LOOP;
END $$;

-- bigserial: service_role necesita USAGE/UPDATE sobre la secuencia del audit_log.
GRANT USAGE, SELECT, UPDATE ON SEQUENCE qa_center.audit_log_id_seq TO service_role;

-- ──────────────────── funciones de cola segura ───────────────────────────────

-- Re-claim de jobs huérfanos: si un worker claimó y nunca marcó heartbeat
-- (o su último heartbeat está vencido) y el run asociado no está finalizado,
-- se libera el job para que otro worker lo tome.
CREATE OR REPLACE FUNCTION qa_center.reclaim_stale_jobs(p_timeout interval DEFAULT '2 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = qa_center, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  WITH stale AS (
    SELECT j.id
      FROM qa_center.runner_jobs j
      JOIN qa_center.runs r ON r.id = j.run_id
     WHERE j.claimed_at IS NOT NULL
       AND r.finished_at IS NULL
       AND j.attempts < j.max_attempts
       AND COALESCE(j.heartbeat_at, j.claimed_at) < now() - p_timeout
  ), updated AS (
    UPDATE qa_center.runner_jobs j
       SET claimed_by   = NULL,
           claimed_at   = NULL,
           heartbeat_at = NULL
      FROM stale
     WHERE j.id = stale.id
     RETURNING j.id
  )
  SELECT count(*) INTO n FROM updated;
  RETURN n;
END $$;

REVOKE ALL     ON FUNCTION qa_center.reclaim_stale_jobs(interval) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION qa_center.reclaim_stale_jobs(interval) TO service_role;

-- Claim atómico del próximo job. Previo al claim ejecuta reclaim_stale_jobs
-- para que jobs huérfanos vuelvan a la cola. Filtra `attempts >= max_attempts`
-- (agotados) para no reintentarlos en bucle.
CREATE OR REPLACE FUNCTION qa_center.claim_next_job(p_worker text)
RETURNS qa_center.runner_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = qa_center, pg_temp
AS $$
DECLARE
  job qa_center.runner_jobs;
BEGIN
  PERFORM qa_center.reclaim_stale_jobs();

  UPDATE qa_center.runner_jobs j
     SET claimed_by   = p_worker,
         claimed_at   = now(),
         heartbeat_at = now(),
         attempts     = j.attempts + 1
   WHERE j.id = (
     SELECT id
       FROM qa_center.runner_jobs
      WHERE claimed_at IS NULL
        AND attempts < max_attempts
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO job;
  RETURN job;
END $$;

REVOKE ALL      ON FUNCTION qa_center.claim_next_job(text) FROM PUBLIC;
GRANT  EXECUTE  ON FUNCTION qa_center.claim_next_job(text) TO service_role;

-- Limpieza periódica de nonces vencidos (puede llamarse desde un cron).
CREATE OR REPLACE FUNCTION qa_center.cleanup_runner_nonces(p_before timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = qa_center, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  WITH d AS (
    DELETE FROM qa_center.runner_nonces WHERE expires_at < p_before RETURNING 1
  )
  SELECT count(*) INTO n FROM d;
  RETURN n;
END $$;

REVOKE ALL     ON FUNCTION qa_center.cleanup_runner_nonces(timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION qa_center.cleanup_runner_nonces(timestamptz) TO service_role;

-- Trigger `updated_at` compartido para tablas que lo tienen.
CREATE OR REPLACE FUNCTION qa_center.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = qa_center, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['projects','suites','findings']) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_updated_at ON qa_center.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON qa_center.%I '
      'FOR EACH ROW EXECUTE FUNCTION qa_center.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- =============================================================================
-- FIN. Nada se migra automáticamente: esta migración se aplica cuando un humano
-- la corra contra el Supabase existente (backup previo del catálogo requerido).
-- =============================================================================
