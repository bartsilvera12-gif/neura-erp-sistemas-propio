-- Preferencias de notificaciones push por asesor (chat / avisos / soporte / proyectos).
-- Guardadas por (empresa_id, usuario_id); default true para no cambiar comportamiento histórico.
-- El dispatcher (lib/cc/dispatch-notifications.ts) consulta estas prefs antes de mandar
-- el push al token FCM; si la categoría está en false, el evento se marca "skipped" y no
-- se envía. Afecta solo al usuario con la pref off — el resto del equipo recibe normal.

CREATE TABLE IF NOT EXISTS neura.agente_notification_prefs (
  usuario_id uuid NOT NULL,
  empresa_id uuid NOT NULL,
  chat_enabled boolean NOT NULL DEFAULT true,
  avisos_enabled boolean NOT NULL DEFAULT true,
  soporte_enabled boolean NOT NULL DEFAULT true,
  proyectos_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usuario_id)
);
