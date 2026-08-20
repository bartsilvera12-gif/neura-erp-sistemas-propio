/**
 * Sonido de la campanita de notificaciones (proyectos: QA, cambios de estado,
 * avisos de esqueleto). Mismo mecanismo que `inbox-notification-preference.ts`
 * del chat —tono sintetizado, sin archivo externo—, pero en un módulo aparte:
 * son dos flujos de notificación distintos y no hay que acoplarlos.
 *
 * A diferencia del inbox (que es opt-in, porque un mensaje de chat nuevo puede
 * llegar cada pocos segundos), acá el default es ON: el volumen de avisos es
 * bajo —unos pocos por día— y el sonido fue un pedido explícito.
 */

const STORAGE_KEY = "neura_erp_proyectos_notification_sound";

export function leerSonidoActivado(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === "1" || v === "true";
  } catch {
    return true;
  }
}

export function escribirSonidoActivado(activado: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, activado ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * Dos notas cortas ascendentes (~280 ms en total). Se resuelve con Web Audio
 * en vez de un archivo de audio: no hay asset que servir ni CORS que resolver,
 * y el volumen queda fijo y consistente sin depender de un .mp3 grabado.
 */
export function reproducirSonidoNotificacion(): void {
  if (!leerSonidoActivado()) return;
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const ahora = ctx.currentTime;
    const notas: { freq: number; inicio: number }[] = [
      { freq: 880, inicio: 0 }, // A5
      { freq: 1318.5, inicio: 0.09 }, // E6
    ];
    for (const { freq, inicio } of notas) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Envolvente corta para evitar el "click" de encender/apagar el tono seco.
      gain.gain.setValueAtTime(0, ahora + inicio);
      gain.gain.linearRampToValueAtTime(0.07, ahora + inicio + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ahora + inicio + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ahora + inicio);
      osc.stop(ahora + inicio + 0.16);
    }
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 400);
  } catch {
    /* Sin audio disponible (política del navegador, contexto bloqueado, etc.):
       la notificación igual llegó y se ve en el panel. */
  }
}

/**
 * Sonido de recordatorio de REUNIÓN. Deliberadamente distinto y más insistente
 * que el de arriba: una reunión que arranca en 30 minutos no puede sonar igual
 * que una observación de QA, o se confunde con el ruido de fondo y pasa
 * desapercibida — que es justo lo que hay que evitar.
 *
 * Qué lo hace destacar, sin llegar a alarma de incendio:
 *  - Tres repeticiones espaciadas (~1,2 s en total) en vez de un tono corto.
 *  - Onda `triangle`, con más armónicos que la `sine` y por lo tanto más
 *    presencia sobre el ruido ambiente de una oficina.
 *  - Cada repetición son dos notas que SALTAN una quinta (E5→B5), un intervalo
 *    que el oído lee como llamada y no como confirmación.
 *  - Volumen algo mayor (0.11 contra 0.07), todavía lejos de molestar.
 */
export function reproducirSonidoReunion(): void {
  if (!leerSonidoActivado()) return;
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const ahora = ctx.currentTime;

    const PATRON = [0, 0.4, 0.8]; // arranque de cada repetición, en segundos
    const NOTAS = [
      { freq: 659.25, offset: 0 }, // E5
      { freq: 987.77, offset: 0.11 }, // B5 — salto de quinta
    ];

    for (const base of PATRON) {
      for (const { freq, offset } of NOTAS) {
        const inicio = ahora + base + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, inicio);
        gain.gain.linearRampToValueAtTime(0.11, inicio + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(inicio);
        osc.stop(inicio + 0.2);
      }
    }

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 1600);
  } catch {
    /* Igual que arriba: sin audio, la notificación se ve en el panel. */
  }
}
