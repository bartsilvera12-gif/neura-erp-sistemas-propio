/**
 * Lo que el menú lateral decidió que ESTA sesión puede ver, agrupado por familia.
 *
 * El Sidebar es el único que resuelve permisos de menú (módulos, rol, accesos
 * especiales). Las portadas (`/panel/<familia>`) no repiten esa lógica: leen de
 * acá, así una tarjeta aparece exactamente cuando el ítem aparece en el menú.
 * Esconder una tarjeta no es el permiso: cada página y cada API lo vuelven a
 * comprobar, igual que con el menú.
 */
import { useSyncExternalStore } from "react";

/** `fav`: id con el que esta pantalla se guarda en favoritos (ver `lib/favorites`). */
export type PantallaMenu = { label: string; href: string; fav: string };
export type FamiliaMenu = { id: string; title: string; pantallas: PantallaMenu[] };
export type MenuVisible = { cargando: boolean; familias: FamiliaMenu[] };

let estado: MenuVisible = { cargando: true, familias: [] };
const oyentes = new Set<() => void>();

export function publicarMenuVisible(siguiente: MenuVisible): void {
  // Evita renders en cadena: el Sidebar publica en cada render de sus datos.
  if (JSON.stringify(siguiente) === JSON.stringify(estado)) return;
  estado = siguiente;
  oyentes.forEach((f) => f());
}

function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

const ESTADO_SERVIDOR: MenuVisible = { cargando: true, familias: [] };

export function useMenuVisible(): MenuVisible {
  return useSyncExternalStore(suscribir, () => estado, () => ESTADO_SERVIDOR);
}

/** Ruta de la portada de una familia. "inicio" no tiene portada: va al Dashboard. */
export function hrefFamilia(id: string): string {
  return id === "inicio" ? "/" : `/panel/${id}`;
}
