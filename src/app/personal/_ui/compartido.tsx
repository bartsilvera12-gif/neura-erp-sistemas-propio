"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Star, X } from "lucide-react";

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Si un Select abierto ya consumió el Escape (preventDefault), no cerramos el modal.
      if (e.key === "Escape" && !e.defaultPrevented) onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);
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

/* ---------------------------------------------------------------- Select elegante
 * Dropdown propio (no <select> nativo). Se despliega en un portal con posición fija
 * para que no lo recorte el scroll de una modal. Teclado: Esc cierra.
 */
export type OpcionSelect = { value: string; label: string };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Seleccionar…",
  className,
  size = "md",
}: {
  value: string;
  onChange: (value: string) => void;
  options: OpcionSelect[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; arriba: boolean } | null>(null);
  const sel = options.find((o) => o.value === value);

  const medir = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Si no hay lugar abajo, abrir hacia arriba.
    const espacioAbajo = window.innerHeight - r.bottom;
    const arriba = espacioAbajo < 260 && r.top > espacioAbajo;
    setRect({
      top: arriba ? r.top - 4 : r.bottom + 4,
      left: r.left,
      width: r.width,
      arriba,
    });
  };
  useEffect(() => {
    if (!open) return;
    medir();
    // Reposicionar (no cerrar) cuando la página hace scroll o cambia de tamaño,
    // ignorando el scroll que ocurre DENTRO de la propia lista.
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      medir();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", medir);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", medir);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pad = size === "sm" ? "px-2.5 py-1.5 text-[13px]" : "px-3 py-2 text-sm";
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-between gap-2 rounded-lg border bg-white text-left text-slate-700 shadow-sm outline-none transition hover:border-[#4FAEB2]/60 focus:ring-2 focus:ring-[#4FAEB2]/20 ${pad} ${open ? "border-[#4FAEB2]" : "border-slate-200"} ${className ?? ""}`}
      >
        <span className={`truncate ${sel ? "text-slate-800" : "text-slate-400"}`}>{sel?.label ?? placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && rect
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[60]" onMouseDown={() => setOpen(false)} />
              <div
                ref={panelRef}
                className="fixed z-[61] max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
                style={{
                  left: rect.left,
                  width: rect.width,
                  ...(rect.arriba
                    ? { bottom: window.innerHeight - rect.top }
                    : { top: rect.top }),
                }}
              >
                {options.map((o) => {
                  const act = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => { onChange(o.value); setOpen(false); }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition ${act ? "bg-[#4FAEB2]/10 font-semibold text-[#2F8E92]" : "text-slate-600 hover:bg-slate-50"}`}
                    >
                      <span className="truncate">{o.label}</span>
                      {act ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            </>,
            document.body
          )
        : null}
    </>
  );
}

/** Campo etiquetado vertical (label arriba, control abajo). */
export function Campo({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

/** Estado vacío consistente (icono + título + ayuda corta). */
export function EmptyState({ icon: Icon, titulo, descripcion }: { icon: typeof X; titulo: string; descripcion?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon className="h-5 w-5" aria-hidden /></span>
      <p className="text-[13.5px] font-semibold text-slate-500">{titulo}</p>
      {descripcion ? <p className="max-w-xs text-[12.5px] text-slate-400">{descripcion}</p> : null}
    </div>
  );
}

/** Puntuación por estrellas (1–5), elegante y clickeable. */
export function RatingStars({ value, onChange, readOnly }: { value: number; onChange?: (n: number) => void; readOnly?: boolean }) {
  const [hover, setHover] = useState(0);
  const activo = hover || value;
  return (
    <div className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(n)}
          onMouseEnter={() => !readOnly && setHover(n)}
          className={`rounded p-0.5 transition ${readOnly ? "cursor-default" : "hover:scale-110"}`}
          aria-label={`${n} de 5`}
        >
          <Star className={`h-5 w-5 ${n <= activo ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} aria-hidden />
        </button>
      ))}
    </div>
  );
}
