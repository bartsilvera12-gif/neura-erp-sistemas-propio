/**
 * Sonidos de aviso del ERP: campanita general, recordatorio de reunión y
 * chat de cliente. Reproduce el tono elegido por el operador (12 opciones
 * personalizables desde el dropdown de la campanita); default: Tono 1.
 *
 * `prepararSonidos()` se llama al montar el layout para desbloquear la
 * reproducción con el primer gesto (WebViews / autoplay policies).
 */

import { obtenerUrlTonoActual } from "@/lib/notificaciones/tono-preferencia";

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

// Cache de un HTMLAudioElement por URL para no crear uno por aviso. Al cambiar
// de tono en la config, la próxima llamada carga el nuevo y descarta el viejo.
let audioActual: { url: string; el: HTMLAudioElement } | null = null;

function obtenerAudio(url: string): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioActual || audioActual.url !== url) {
      const el = new Audio(url);
      el.preload = "auto";
      el.volume = 0.8;
      audioActual = { url, el };
    }
    return audioActual.el;
  } catch {
    return null;
  }
}

/**
 * Desbloquea el audio con el primer gesto del usuario. Los WebViews y algunos
 * navegadores no dejan reproducir sonido sin una interacción previa; hacemos
 * un play()+pause() silencioso en el primer pointerdown/keydown para que los
 * avisos posteriores suenen sin fricción.
 */
export function prepararSonidos(): void {
  if (typeof window === "undefined") return;
  const desbloquear = () => {
    const a = obtenerAudio(obtenerUrlTonoActual());
    if (!a) return;
    const volPrev = a.volume;
    a.volume = 0;
    void a
      .play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        a.volume = volPrev;
        window.removeEventListener("pointerdown", desbloquear);
        window.removeEventListener("keydown", desbloquear);
      })
      .catch(() => {
        a.volume = volPrev;
      });
  };
  window.addEventListener("pointerdown", desbloquear, { passive: true });
  window.addEventListener("keydown", desbloquear);
}

function reproducir(): void {
  if (!leerSonidoActivado()) return;
  const a = obtenerAudio(obtenerUrlTonoActual());
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {
    /* Sin audio disponible: el aviso igual llegó y se ve en el panel. */
  }
}

/** Campanita general (QA, cambios de estado, avisos de esqueleto). */
export function reproducirSonidoNotificacion(): void {
  reproducir();
}

/** Recordatorio de reunión. */
export function reproducirSonidoReunion(): void {
  reproducir();
}

/** Chat de cliente esperando en la cola. */
export function reproducirSonidoConversacion(): void {
  reproducir();
}
