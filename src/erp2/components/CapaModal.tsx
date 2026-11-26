"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useViewportVisible } from "@/erp2/lib/ui/responsive";

/**
 * Capa ÚNICA para todos los modales del ERP. Resuelve de una vez el "modal cortado":
 *   · se monta en <body> (portal): ningún contenedor con overflow/transform lo recorta
 *   · centrado con margen SIEMPRE (p-4 / sm:p-6): nunca toca los bordes de la ventana
 *   · si el contenido es más alto que la pantalla, la capa scrollea (nunca queda cortado
 *     arriba, el bug de "flex items-center" + contenido alto)
 *   · bloquea el scroll del fondo compensando la barra (la página no salta)
 *   · Escape y click afuera cierran (si se pasa onClose)
 * El panel de cada modal debe usar `max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]`
 * (clase ALTO_MAX_MODAL) con cabecera y pie fijos y el cuerpo con overflow-y-auto.
 *
 * RESPONSIVE (automático, sin tocar cada modal — reglas en globals.css):
 *   · celular (< 640 px): el panel (hijo directo) pasa a HOJA INFERIOR a todo el ancho, con las
 *     esquinas de arriba redondeadas y el safe-area de abajo. Si usa ALTO_MAX_MODAL (clase
 *     `modal-alto`) se limita al alto VISIBLE: con el teclado abierto (también en iOS, vía
 *     visualViewport → --capa-alto) el pie de acciones sigue a la vista; sus botones miden 44 px.
 *   · táctil: los botones "Cerrar" (aria-label) miden 44 × 44.
 *   · táctil: el botón "atrás" del celular cierra el modal de arriba (no se va de la pantalla).
 *   · tablet/escritorio: igual que siempre (centrado con margen).
 * Para que un modal nuevo se vea bien en celular alcanza con: panel = hijo directo de CapaModal,
 * `flex flex-col` + ALTO_MAX_MODAL, cabecera y pie `shrink-0` (el pie, ÚLTIMO hijo) y el cuerpo
 * `min-h-0 flex-1 overflow-y-auto`.
 */
export const ALTO_MAX_MODAL = "modal-alto max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]";

// ── "Atrás" del celular ─────────────────────────────────────────────────────────────────
// Cada modal abierto agrega una entrada al historial (misma URL) con su id en `__capas`;
// "atrás" la saca y el modal cuyo id ya no está se cierra. Si el modal se cierra con un
// botón, su entrada queda en el historial marcada como cerrada: el próximo "atrás" que salga
// de ella sin cambiar de pantalla sigue de largo solo (así nunca hay un "atrás" que no hace nada).
const cerradas = new Set<string>();
let actual: { href: string; top?: string } = { href: "" };
let escuchando = false;
const topDe = (s: unknown) => {
  const c = (s as { __capas?: string[] } | null)?.__capas;
  return c?.[c.length - 1];
};
function alVolverGlobal() {
  const antes = actual;
  actual = { href: window.location.href, top: topDe(window.history.state) };
  if (antes.top && cerradas.has(antes.top) && antes.top !== actual.top && antes.href === actual.href) window.history.back();
}

function useAtrasCierra(onClose: (() => void) | undefined) {
  const cerrar = useRef(onClose);
  useEffect(() => { cerrar.current = onClose; }, [onClose]);
  const habilitado = !!onClose;
  useEffect(() => {
    if (!habilitado || !window.matchMedia("(pointer: coarse)").matches) return;
    const id = Math.random().toString(36).slice(2);
    const prev = (window.history.state ?? {}) as { __capas?: string[] };
    window.history.pushState({ ...prev, __capas: [...(prev.__capas ?? []), id] }, "");
    actual = { href: window.location.href, top: id };
    if (!escuchando) { escuchando = true; window.addEventListener("popstate", alVolverGlobal); }
    const href = window.location.href;
    const enHistoria = () => ((window.history.state as { __capas?: string[] } | null)?.__capas ?? []).includes(id);
    const onPop = () => { if (!enHistoria()) cerrar.current?.(); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Se cerró con un botón (su entrada sigue en el historial) o se fue a otra pantalla:
      // la entrada queda como cerrada. Si la sacó "atrás" (otra escucha pudo cerrarlo antes), no.
      if (enHistoria() || window.location.href !== href) cerradas.add(id);
    };
  }, [habilitado]);
}

export function CapaModal({
  onClose,
  children,
  z = "z-50",
  fondo = "bg-slate-900/45 backdrop-blur-[2px]",
  cerrarConEscape = true,
}: {
  onClose?: () => void;
  children: React.ReactNode;
  z?: string;
  fondo?: string;
  cerrarConEscape?: boolean;
}) {
  const [montado, setMontado] = useState(false);
  const capa = useRef<HTMLDivElement>(null);
  useEffect(() => setMontado(true), []);
  useAtrasCierra(onClose);
  // Celular/tablet: la capa sigue al viewport visible (teclado de iOS) y deja --capa-alto.
  useViewportVisible(capa, montado);

  useEffect(() => {
    if (!montado) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !cerrarConEscape || !onClose) return;
      // Con modales apilados (ej. un modal dentro de la ficha), Escape cierra solo el de arriba.
      const capas = document.querySelectorAll("[data-capa-modal]");
      if (capas.length && capas[capas.length - 1] !== capa.current) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const barra = window.innerWidth - document.documentElement.clientWidth;
    if (barra > 0) body.style.paddingRight = `${barra}px`;
    body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [montado, onClose, cerrarConEscape]);

  if (!montado) return null;
  const afuera = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && onClose) onClose();
  };
  return createPortal(
    <div
      ref={capa}
      data-capa-modal=""
      className={`fixed inset-0 ${z} overflow-y-auto overscroll-contain ${fondo}`}
      style={{ animation: "modal-backdrop 0.15s ease-out" }}
      onMouseDown={afuera}
    >
      <div data-capa-centro="" className="flex min-h-full items-center justify-center p-4 sm:p-6" onMouseDown={afuera}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
