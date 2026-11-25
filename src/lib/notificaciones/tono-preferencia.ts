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

/** Nombres propios de algunos tonos; el resto se muestra como "Tono N". */
const NOMBRES: Record<string, string> = {
  "13": "Pluh",
};

/** Tonos disponibles (mismos archivos que public/sounds/tonos/{id}.mp3). */
export const TONOS: readonly Tono[] = Array.from({ length: 13 }, (_, i) => {
  const id = String(i + 1);
  return { id, nombre: NOMBRES[id] ?? `Tono ${id}`, url: `/sounds/tonos/${id}.mp3` };
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

/**
 * Tono propio del chat interno: un mensaje de un compañero tiene que sonar
 * distinto del resto de los avisos, para saber qué es sin mirar la pantalla.
 */
const STORAGE_KEY_CHAT = "neura_erp_chat_interno_tone";
export const TONO_CHAT_POR_DEFECTO = "13";

export function leerTonoChat(): string {
  if (typeof window === "undefined") return TONO_CHAT_POR_DEFECTO;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY_CHAT);
    if (v && TONOS.some((t) => t.id === v)) return v;
  } catch {
    /* ignore */
  }
  // Si el tono general ya es el del chat, el default del chat pasa a otro para que no se confundan.
  return leerTonoSeleccionado() === TONO_CHAT_POR_DEFECTO ? "2" : TONO_CHAT_POR_DEFECTO;
}

export function escribirTonoChat(id: string): void {
  if (typeof window === "undefined") return;
  if (!TONOS.some((t) => t.id === id)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY_CHAT, id);
  } catch {
    /* ignore */
  }
}

export function obtenerUrlTonoChat(): string {
  const id = leerTonoChat();
  return TONOS.find((t) => t.id === id)?.url ?? TONOS[0].url;
}
