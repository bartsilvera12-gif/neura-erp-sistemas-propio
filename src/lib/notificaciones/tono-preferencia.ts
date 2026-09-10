/**
 * Preferencia del operador: qué tono usar para todos los avisos sonoros del
 * ERP (campanita del header + inbox de conversaciones).
 *
 * Persistencia solo en el navegador (localStorage), por usuario/máquina. Los
 * archivos viven en /public/sounds/tonos/{id}.mp3 y los servimos como estáticos.
 */

const STORAGE_KEY = "neura_erp_notification_tone";
export const TONO_POR_DEFECTO = "1";

export type Tono = { id: string; nombre: string; url: string };

/** 12 tonos disponibles (mismos archivos que public/sounds/tonos/). */
export const TONOS: readonly Tono[] = Array.from({ length: 12 }, (_, i) => {
  const id = String(i + 1);
  return { id, nombre: `Tono ${id}`, url: `/sounds/tonos/${id}.mp3` };
});

export function leerTonoSeleccionado(): string {
  if (typeof window === "undefined") return TONO_POR_DEFECTO;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (!v) return TONO_POR_DEFECTO;
    return TONOS.some((t) => t.id === v) ? v : TONO_POR_DEFECTO;
  } catch {
    return TONO_POR_DEFECTO;
  }
}

export function escribirTonoSeleccionado(id: string): void {
  if (typeof window === "undefined") return;
  if (!TONOS.some((t) => t.id === id)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function obtenerUrlTonoActual(): string {
  const id = leerTonoSeleccionado();
  return TONOS.find((t) => t.id === id)?.url ?? TONOS[0].url;
}
