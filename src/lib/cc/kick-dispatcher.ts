/**
 * Dispara el dispatcher de push en modo fire-and-forget.
 *
 * El diseño original dependía 100% del cron cada minuto para leer
 * `agent_notification_events` y mandar los push por FCM. Ese cron es externo
 * (scheduled task de Coolify): si se cuelga, los eventos se apilan pending y
 * NADIE lo nota hasta que un asesor reclama que "no me llegan las
 * notificaciones". Pasó (18-Sep-2026) y 300 eventos quedaron sin despachar.
 *
 * Este helper hace lo obvio: apenas se INSERTA un evento nuevo, el propio
 * proceso Next.js le pega al endpoint del dispatcher para que lo procese en
 * segundos, sin esperar al próximo tick del cron. Fire-and-forget, sin
 * await: el flujo que lo llama (webhook / saveIncomingMessage) no puede
 * bloquearse por esto. El cron se mantiene como red de contención por si
 * este disparo se pierde (proceso reciclado en medio, timeout, etc.).
 *
 * Requisitos:
 *  - `CRON_SECRET` seteado (mismo secret que usa el cron).
 *  - El endpoint escucha en el propio contenedor: usamos localhost:PORT
 *    para no depender del dominio público ni pagar TLS/DNS a nosotros mismos.
 */
export function kickPushDispatcher(): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return; // Sin secret el cron tampoco funcionaría: nada que hacer.

  const port = process.env.PORT?.trim() || "3000";
  const url = `http://127.0.0.1:${port}/api/cron/cc-notifications-dispatch?limit=100`;

  // AbortController con timeout: si el dispatcher tarda >20s (raro), soltamos
  // la conexión. El cron lo volverá a intentar. Nunca queremos que este disparo
  // deje handles colgados que impidan reciclar el proceso.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);

  // No await: el caller ya devolvió su respuesta.
  fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
    signal: ac.signal,
    // `keepalive` no aplica en Node fetch, pero es la intención semántica.
  })
    .catch(() => {
      /* silencioso a propósito: el cron sigue siendo la red de contención */
    })
    .finally(() => clearTimeout(t));
}
