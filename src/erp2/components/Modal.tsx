"use client";

import { X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";

/**
 * Modal centrado con backdrop. Cierra con Escape o click afuera.
 * Montado sobre CapaModal (portal a <body>, margen siempre, scroll-lock sin salto).
 * La cabecera queda fija y sólo el cuerpo scrollea: nunca se corta.
 */
export function Modal({
  titulo,
  onClose,
  children,
  size = "md",
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  const maxW = size === "xl" ? "max-w-2xl" : size === "lg" ? "max-w-lg" : "max-w-md";
  return (
    <CapaModal onClose={onClose} fondo="bg-slate-900/30 backdrop-blur-[2px]">
      <div
        className={`flex w-full ${maxW} ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </CapaModal>
  );
}
