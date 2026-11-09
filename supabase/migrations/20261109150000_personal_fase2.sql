-- =============================================================================
-- Gestión de Personal (RRHH) · Fase 2 + 3 — Asistencia, Vacaciones, Desempeño
-- -----------------------------------------------------------------------------
--   · `personal_asistencia`: marca diaria (entrada/salida, estado, minutos de
--     atraso). Alimenta el KPI de % de asistencia y las llegadas tardías reales.
--   · `personal_vacaciones`: solicitudes de vacaciones / permisos / licencias con
--     flujo de aprobación y saldo anual.
--   · `personal_evaluaciones`: evaluaciones de desempeño (puntaje + competencias).
--   · `usuarios.dias_vacaciones_anuales`: cupo anual (Paraguay: 12 por defecto).
--
-- Tablas solo-API: RLS activa, sin políticas, GRANT solo a service_role. Aditiva
-- e idempotente. Solo schema `neura`. El "Historial" se arma por lectura (unión
-- de incidencias + asistencia + vacaciones + desempeño), no necesita tabla.
-- =============================================================================

SET client_encoding = 'UTF8';
SET lock_timeout = '5s';

-- ---------------------------------------------------------- usuarios (vacaciones)
ALTER TABLE neura.usuarios ADD COLUMN IF NOT EXISTS dias_vacaciones_anuales integer;

-- ---------------------------------------------------------- personal_asistencia
CREATE TABLE IF NOT EXISTS neura.personal_asistencia (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  usuario_id     uuid NOT NULL REFERENCES neura.usuarios(id) ON DELETE CASCADE,
  fecha          date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Asuncion')::date,
  estado         text NOT NULL DEFAULT 'presente' CHECK (estado IN (
                   'presente','tarde','ausente','justificada','permiso','vacaciones')),
  hora_entrada   time,
  hora_salida    time,
  minutos_tarde  integer NOT NULL DEFAULT 0 CHECK (minutos_tarde >= 0),
  observacion    text,
  registrado_por_id    uuid,
  registrado_por_label text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_personal_asis_dia UNIQUE (usuario_id, fecha)
);
CREATE INDEX IF NOT EXISTS ix_personal_asis_usuario ON neura.personal_asistencia (empresa_id, usuario_id, fecha DESC);

ALTER TABLE neura.personal_asistencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON neura.personal_asistencia FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.personal_asistencia TO service_role;

-- ---------------------------------------------------------- personal_vacaciones
CREATE TABLE IF NOT EXISTS neura.personal_vacaciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  usuario_id     uuid NOT NULL REFERENCES neura.usuarios(id) ON DELETE CASCADE,
  tipo           text NOT NULL DEFAULT 'vacaciones' CHECK (tipo IN (
                   'vacaciones','permiso','licencia','reposo')),
  fecha_inicio   date NOT NULL,
  fecha_fin      date NOT NULL,
  dias           numeric(5,1) NOT NULL DEFAULT 0 CHECK (dias >= 0),
  motivo         text,
  estado         text NOT NULL DEFAULT 'solicitada' CHECK (estado IN (
                   'solicitada','aprobada','rechazada','anulada','gozada')),
  aprobado_por_id    uuid,
  aprobado_por_label text,
  aprobado_at    timestamptz,
  registrado_por_label text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_personal_vac_rango CHECK (fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS ix_personal_vac_usuario ON neura.personal_vacaciones (empresa_id, usuario_id, fecha_inicio DESC);

ALTER TABLE neura.personal_vacaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON neura.personal_vacaciones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.personal_vacaciones TO service_role;

-- -------------------------------------------------------- personal_evaluaciones
CREATE TABLE IF NOT EXISTS neura.personal_evaluaciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  usuario_id     uuid NOT NULL REFERENCES neura.usuarios(id) ON DELETE CASCADE,
  periodo        text NOT NULL,
  fecha          date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Asuncion')::date,
  puntaje        numeric(3,1) CHECK (puntaje IS NULL OR (puntaje >= 0 AND puntaje <= 5)),
  competencias   jsonb NOT NULL DEFAULT '[]'::jsonb,
  fortalezas     text,
  mejoras        text,
  comentario     text,
  estado         text NOT NULL DEFAULT 'finalizada' CHECK (estado IN ('borrador','finalizada')),
  evaluador_id    uuid,
  evaluador_label text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_personal_eval_usuario ON neura.personal_evaluaciones (empresa_id, usuario_id, fecha DESC);

ALTER TABLE neura.personal_evaluaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON neura.personal_evaluaciones FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON neura.personal_evaluaciones TO service_role;

NOTIFY pgrst, 'reload schema';
