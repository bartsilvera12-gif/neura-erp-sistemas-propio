"use client";

import { useSyncExternalStore } from "react";
import { EVENTO_TEMA, LETRA_POR_DEFECTO, TEMA_POR_DEFECTO, leerLetras, leerTema, type LetraId } from "./tema-color";

function suscribir(f: () => void): () => void {
  window.addEventListener(EVENTO_TEMA, f);
  return () => window.removeEventListener(EVENTO_TEMA, f);
}

/** El color elegido en este navegador, al día: nombre de la lista o "#rrggbb". */
export function useTema(): string {
  return useSyncExternalStore(suscribir, leerTema, () => TEMA_POR_DEFECTO);
}

/** El color de las letras sobre el color del sistema, al día. */
export function useLetras(): LetraId {
  return useSyncExternalStore(suscribir, leerLetras, () => LETRA_POR_DEFECTO);
}
