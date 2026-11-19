/**
 * Favoritos del menú, guardados en este navegador.
 *
 * Cada favorito es un id de texto:
 *  - la `key` de un ítem del menú ("crm", "soporte"…): el ítem entero, como siempre;
 *  - `ruta:<href>` para una pantalla de adentro ("ruta:/dashboard/soporte/tickets").
 * Los ids viejos siguen valiendo tal cual: sumar el segundo formato no toca lo ya guardado.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "neura_favoritos";
const EVENTO = "neura:favoritos";

/** Id de favorito de una pantalla de adentro (hija de un ítem del menú). */
export function favDeRuta(href: string): string {
  return `ruta:${href}`;
}

export function getFavoritos(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const lista: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function setFavoritos(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENTO));
}

export function toggleFavorito(id: string): string[] {
  const current = getFavoritos();
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  setFavoritos(next);
  return next;
}

// ── Para leerlos desde cualquier pantalla y enterarse cuando cambian ──────────
const VACIO: string[] = [];
let crudoVisto: string | null | undefined;
let listaVista: string[] = VACIO;

function foto(): string[] {
  let crudo: string | null = null;
  try {
    crudo = localStorage.getItem(STORAGE_KEY);
  } catch {
    crudo = null;
  }
  if (crudo !== crudoVisto) {
    crudoVisto = crudo;
    listaVista = getFavoritos();
  }
  return listaVista;
}

function suscribir(f: () => void): () => void {
  window.addEventListener(EVENTO, f);
  window.addEventListener("storage", f);
  return () => {
    window.removeEventListener(EVENTO, f);
    window.removeEventListener("storage", f);
  };
}

/** Favoritos al día: el menú y las portadas se enteran entre sí (y entre pestañas). */
export function useFavoritos(): string[] {
  return useSyncExternalStore(suscribir, foto, () => VACIO);
}
