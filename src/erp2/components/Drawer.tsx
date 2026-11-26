"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useViewportVisible } from "@/erp2/lib/ui/responsive";

/**
 * Panel lateral deslizante (slide-over) de alto completo. Para formularios con
 * varios campos: el título queda fijo arriba, el cuerpo scrollea, y el pie
 * (acciones) queda pegado abajo — nunca se corta como un modal centrado alto.
 * Se monta en <body> (portal): dentro del contenido, la barra superior de la app le
 * tapaba el título.
 *
 * Responsive: en celular ocupa toda la pantalla (100 % del ancho, alto VISIBLE: con el
 * teclado abierto el pie sigue a la vista, también en iOS), respeta los safe-area y los
 * botones del pie / la cruz miden 44 px. En tablet y escritorio, panel de hasta 576 px.
 */
export function Drawer({
  titulo,
  subtitulo,
  onClose,
  children,
  footer,
}: {
  titulo: string;
  subtitulo?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const capa = useRef<HTMLDivElement>(null);
  useViewportVisible(capa);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capas apiladas (modales y paneles marcan data-capa-modal): Escape cierra solo la de
      // arriba. Si hay un modal abierto ENCIMA del panel, es de él; si el panel se abrió desde
      // un modal (ej. "Seguimiento" en el detalle del presupuesto), es del panel.
      const capas = document.querySelectorAll("[data-capa-modal]");
      if (capas.length && capas[capas.length - 1] !== capa.current) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={capa}
      data-capa-modal=""
      className="fixed inset-0 z-[110] flex justify-end bg-slate-900/40 backdrop-blur-[2px]"
      style={{ animation: "modal-backdrop 0.15s ease-out" }}
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        style={{ animation: "drawer-in 0.22s cubic-bezier(0.16,1,0.3,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pt-safe shrink-0 border-b border-slate-100">
          <div className="flex items-center justify-between gap-2 py-2.5 pl-4 pr-2 sm:py-4 sm:pl-6 sm:pr-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-900">{titulo}</h2>
              {subtitulo ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitulo}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:h-9 sm:w-9"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">{children}</div>

        {footer ? (
          <footer className="pb-safe shrink-0 border-t border-slate-100 bg-white">
            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6 sm:py-4 max-sm:[&_a]:min-h-11 max-sm:[&_button]:min-h-11">{footer}</div>
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
