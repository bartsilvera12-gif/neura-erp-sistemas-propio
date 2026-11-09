"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold ring-1 ring-inset ${className ?? ""}`}>
      {children}
    </span>
  );
}

/** Modal estándar del 2.0 (patrón CapaModal: portal, margen, alto máx, cuerpo con scroll). */
export function Modal({
  titulo,
  onCerrar,
  children,
  footer,
  ancho = "max-w-md",
}: {
  titulo: string;
  onCerrar: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  ancho?: string;
}) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
    >
      <div className={`flex max-h-[90vh] w-full ${ancho} flex-col overflow-hidden rounded-2xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h4 className="text-[15px] font-bold text-slate-900">{titulo}</h4>
          <button type="button" onClick={onCerrar} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

/** Tarjeta de sección con cabecera (icono + título + subtítulo) y acción opcional. */
export function SeccionCard({
  icon: Icon,
  colorIcono,
  titulo,
  subtitulo,
  accion,
  children,
}: {
  icon: typeof X;
  colorIcono: string;
  titulo: string;
  subtitulo?: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${colorIcono}`}><Icon className="h-5 w-5" aria-hidden /></span>
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">{titulo}</h3>
            {subtitulo ? <p className="text-[12.5px] text-slate-500">{subtitulo}</p> : null}
          </div>
        </div>
        {accion}
      </div>
      {children}
    </div>
  );
}

export const btnPrimario =
  "inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3F8E91] disabled:opacity-50";
export const btnSecundario =
  "rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50";
