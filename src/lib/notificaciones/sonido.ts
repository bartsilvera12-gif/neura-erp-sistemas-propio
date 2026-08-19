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
