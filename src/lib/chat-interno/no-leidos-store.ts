"use client";

/**
 * Cuántos mensajes del chat interno tengo sin leer, compartido en la página.
 *
 * Lo cuenta `ChatPestanaBadge` (que ya lo pide y escucha el realtime para la
 * pestaña del navegador) y lo publica acá; el menú lateral lo lee para poner el
 * número rojo junto a "Chat interno" sin volver a preguntarle al servidor.
 */

import { useSyncExternalStore } from "react";

let total = 0;
const oyentes = new Set<() => void>();

export function publicarChatNoLeidos(n: number): void {
  const siguiente = Math.max(0, Math.floor(n));
  if (siguiente === total) return;
  total = siguiente;
  oyentes.forEach((f) => f());
}

function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

export function useChatNoLeidos(): number {
  return useSyncExternalStore(
    suscribir,
    () => total,
    () => 0
  );
}
