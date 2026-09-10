/**
 * Preferencia del operador: sonido al recibir mensajes entrantes en el inbox.
 * Persistencia solo en el navegador (localStorage), por usuario/máquina.
 */

import { obtenerUrlTonoActual } from "@/lib/notificaciones/tono-preferencia";

const STORAGE_KEY = "neura_erp_inbox_notification_sound";

export function readInboxNotificationSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) return false;
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export function writeInboxNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Tono de notificación del inbox (usa el tono elegido en la campanita). */
export function playInboxNotificationBeep(): void {
  if (typeof window === "undefined") return;
  try {
    const audio = new Audio(obtenerUrlTonoActual());
    audio.volume = 0.7;
    void audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}
