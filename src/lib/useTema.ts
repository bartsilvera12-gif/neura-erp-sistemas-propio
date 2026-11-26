"use client";

import { useSyncExternalStore } from "react";
import { ESTRELLA_POR_DEFECTO, EVENTO_TEMA, LETRA_POR_DEFECTO, TEMA_POR_DEFECTO, leerEstrella, leerGuardados, leerLetras, leerTema, type LetraId } from "./tema-color";

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

/** El color de las estrellas de favoritos ("original" o "#rrggbb"), al día. */
export function useEstrella(): string {
  return useSyncExternalStore(suscribir, leerEstrella, () => ESTRELLA_POR_DEFECTO);
}

// La lista se compara por su texto para que useSyncExternalStore no vea un arreglo nuevo cada vez.
let ultimoTexto = "";
let ultimaLista: string[] = [];
function guardadosEstables(): string[] {
  const l = leerGuardados();
  const t = l.join(",");
  if (t !== ultimoTexto) {
    ultimoTexto = t;
    ultimaLista = l;
  }
  return ultimaLista;
}
const SIN_GUARDADOS: string[] = [];

/** "Mis colores" guardados en este navegador, al día. */
export function useColoresGuardados(): string[] {
  return useSyncExternalStore(suscribir, guardadosEstables, () => SIN_GUARDADOS);
}
