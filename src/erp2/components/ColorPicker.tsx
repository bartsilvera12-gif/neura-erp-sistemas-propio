"use client";

/**
 * Selector de color: botón con el color actual que abre un panel con la PALETA COMPLETA
 * (cuadro de tono + barra de colores), el código exacto (#rrggbb) y 8 sugeridos para
 * elegir con un toque. Cierra con Esc, click afuera o "Listo".
 * En celular (< 640 px) el panel se abre como HOJA INFERIOR (nunca se sale de la pantalla).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { Check, ChevronDown } from "lucide-react";
import { HojaInferior } from "@/erp2/components/HojaInferior";
import { useEsMovil } from "@/erp2/lib/ui/responsive";

export const COLORES_SUGERIDOS: { hex: string; nombre: string }[] = [
  { hex: "#ef4444", nombre: "Rojo" },
  { hex: "#f97316", nombre: "Naranja" },
  { hex: "#eab308", nombre: "Amarillo" },
  { hex: "#22c55e", nombre: "Verde" },
  { hex: "#14b8a6", nombre: "Turquesa" },
  { hex: "#3b82f6", nombre: "Azul" },
  { hex: "#8b5cf6", nombre: "Violeta" },
  { hex: "#ec4899", nombre: "Rosa" },
];

export function nombreColor(hex: string) {
  return COLORES_SUGERIDOS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.nombre ?? hex.toUpperCase();
}

export function ColorPicker({ value, onChange, block = false }: { value: string; onChange: (hex: string) => void; block?: boolean }) {
  const esMovil = useEsMovil();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  // El panel va a <body> con position: fixed: nunca queda cortado dentro de un modal con
  // scroll. Si abajo no entra (~360 px), se abre hacia arriba.
  useLayoutEffect(() => {
    if (!abierto || esMovil) return;
    const ubicar = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 268));
      if (window.innerHeight - r.bottom >= 370 || r.top < 370) setPos({ left, top: r.bottom + 6 });
      else setPos({ left, bottom: window.innerHeight - r.top + 6 });
    };
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => { window.removeEventListener("resize", ubicar); window.removeEventListener("scroll", ubicar, true); };
  }, [abierto, esMovil]);

  useEffect(() => {
    if (!abierto || esMovil) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panel.current?.contains(t)) return;
      setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setAbierto(false); } };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc, true); };
  }, [abierto, esMovil]);

  const contenido = (
    <>
      <div className="selector-color">
        <HexColorPicker color={value} onChange={onChange} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="h-8 w-8 shrink-0 rounded-lg ring-1 ring-black/10" style={{ backgroundColor: value }} />
        <div className="flex flex-1 items-center rounded-lg border border-slate-200 px-2.5 focus-within:border-[var(--brand)]">
          <span className="text-sm text-slate-400">#</span>
          <HexColorInput color={value} onChange={onChange} aria-label="Código del color" className="w-full bg-transparent py-1.5 pl-1 font-mono text-sm uppercase text-slate-700 outline-none" />
        </div>
      </div>
      <p className="mb-1.5 mt-3 text-[11px] font-medium text-slate-500">Sugeridos</p>
      <div className="grid grid-cols-8 gap-1.5">
        {COLORES_SUGERIDOS.map((c) => {
          const sel = c.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c.hex}
              type="button"
              title={c.nombre}
              aria-label={c.nombre}
              onClick={() => onChange(c.hex)}
              className="flex aspect-square items-center justify-center rounded-lg transition hover:scale-110"
              style={{ backgroundColor: c.hex }}
            >
              {sel ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => setAbierto(false)} className="mt-3 w-full rounded-lg bg-slate-100 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 max-sm:min-h-11">
        Listo
      </button>
    </>
  );

  return (
    <div ref={ref} className={`relative ${block ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex h-[42px] w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white pl-2.5 pr-3 text-sm font-medium text-slate-700 transition hover:border-slate-300"
      >
        <span className="h-6 w-6 shrink-0 rounded-lg ring-1 ring-black/10" style={{ backgroundColor: value }} />
        <span className="flex-1 truncate text-left">{nombreColor(value)}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>

      {abierto && esMovil ? (
        <HojaInferior titulo="Elegí un color" onClose={() => setAbierto(false)} z="z-[200]">{contenido}</HojaInferior>
      ) : null}
      {abierto && !esMovil && pos && typeof document !== "undefined" ? createPortal(
        <div
          ref={panel}
          className="fixed z-[200] w-[260px] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_12px_32px_-8px_rgba(2,48,71,0.25)]"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)" }}
        >
          {contenido}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
