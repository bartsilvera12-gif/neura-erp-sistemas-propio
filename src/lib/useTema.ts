"use client";

import { useSyncExternalStore } from "react";
import { EVENTO_TEMA, TEMA_POR_DEFECTO, leerTema, type TemaId } from "./tema-color";

function suscribir(f: () => void): () => void {
  window.addEventListener(EVENTO_TEMA, f);
  return () => window.removeEventListener(EVENTO_TEMA, f);
}

/** El color elegido en este navegador, al día. */
export function useTema(): TemaId {
  return useSyncExternalStore(suscribir, leerTema, () => TEMA_POR_DEFECTO);
}
