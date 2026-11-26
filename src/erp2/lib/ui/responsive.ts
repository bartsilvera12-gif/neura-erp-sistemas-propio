"use client";

/**
 * Utilidades responsive compartidas (cliente).
 *
 *   · Cortes (mismos que Tailwind): móvil < 640 (sm) · tablet 640–1023 · escritorio ≥ 1024 (lg).
 *     El menú lateral es fijo desde `lg`; abajo es un cajón (drawer) con botón hamburguesa.
 *   · `useMediaQuery(q)` — true/false según la media query (en el servidor y el primer render: false).
 *   · `useEsMovil()` — pantalla < 640 px (celular): listas como hoja inferior, tablas como tarjetas.
 *   · `useEsTactil()` — puntero "grueso" (dedo): tooltips con tap, objetivos de 44 px.
 *   · `useViewportVisible(ref)` — ajusta un elemento `position: fixed` al área VISIBLE (sin el
 *     teclado en pantalla de iOS, que no achica `100dvh`): deja `--capa-alto` con el alto útil.
 */
import { useEffect, useSyncExternalStore, type RefObject } from "react";

export const MQ_MOVIL = "(max-width: 639.98px)";
export const MQ_ESCRITORIO = "(min-width: 1024px)";
export const MQ_TACTIL = "(pointer: coarse)";

// Una función de suscripción estable por query (si cambia en cada render, React re-suscribe).
const suscripciones = new Map<string, (cb: () => void) => () => void>();
function suscribir(q: string) {
  let s = suscripciones.get(q);
  if (!s) {
    s = (cb: () => void) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    };
    suscripciones.set(q, s);
  }
  return s;
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    suscribir(q),
    () => window.matchMedia(q).matches,
    () => false,
  );
}

export const useEsMovil = () => useMediaQuery(MQ_MOVIL);
export const useEsEscritorio = () => useMediaQuery(MQ_ESCRITORIO);
export const useEsTactil = () => useMediaQuery(MQ_TACTIL);

/** Lectura puntual (fuera de React, ej. dentro de un handler). */
export const esMovilAhora = () => typeof window !== "undefined" && window.matchMedia(MQ_MOVIL).matches;

/**
 * Ajusta un elemento `fixed inset-0` al viewport VISIBLE (iOS no achica el layout viewport
 * al abrir el teclado: sin esto, el pie de un modal queda debajo del teclado). Deja en el
 * elemento la variable CSS `--capa-alto` (px) que usan los paneles para su alto máximo.
 * Sólo actúa por debajo de `lg` (en escritorio el visualViewport cambia con el zoom).
 * Además, al enfocar un campo lo trae a la vista dentro de su contenedor con scroll.
 */
export function useViewportVisible(ref: RefObject<HTMLElement | null>, activo = true) {
  useEffect(() => {
    const el = ref.current;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!activo || !el || !vv) return;
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const ajustar = () => {
      if (!mq.matches) {
        el.style.removeProperty("top");
        el.style.removeProperty("height");
        el.style.removeProperty("bottom");
        el.style.removeProperty("--capa-alto");
        return;
      }
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
      el.style.bottom = "auto";
      el.style.setProperty("--capa-alto", `${vv.height}px`);
    };
    const alEnfocar = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !mq.matches || !t.matches("input, textarea, select, [contenteditable='true']")) return;
      // Espera a que el teclado termine de abrir (iOS ~250 ms) y lo trae a la vista.
      window.setTimeout(() => t.scrollIntoView({ block: "nearest", behavior: "smooth" }), 280);
    };
    ajustar();
    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
    mq.addEventListener("change", ajustar);
    el.addEventListener("focusin", alEnfocar);
    return () => {
      vv.removeEventListener("resize", ajustar);
      vv.removeEventListener("scroll", ajustar);
      mq.removeEventListener("change", ajustar);
      el.removeEventListener("focusin", alEnfocar);
    };
  }, [ref, activo]);
}
