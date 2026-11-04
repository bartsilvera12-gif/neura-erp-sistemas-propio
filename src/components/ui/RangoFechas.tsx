"use client";

import { ArrowRight } from "lucide-react";
import { FechaSelect } from "@/components/ui/FechaSelect";

/**
 * Control de rango de fechas "Desde → Hasta" en una sola pieza.
 *
 * Dos `FechaSelect` sin borde, con etiqueta chica arriba y una flecha al medio,
 * dentro de una píldora con foco compartido (focus-within). Reemplaza al par de
 * inputs sueltos, que se veían partidos.
 */

const CAMPO =
  "block w-full border-0 bg-transparent p-0 text-[13px] font-semibold tabular-nums text-slate-800 outline-none placeholder:text-slate-300 focus:ring-0";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex cursor-text flex-col gap-0.5">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <div className="w-[104px]">{children}</div>
    </label>
  );
}

export type RangoFechasProps = {
  desde: string;
  hasta: string;
  onDesde: (v: string) => void;
  onHasta: (v: string) => void;
  /** Tope superior de ambas fechas (p. ej. hoy). */
  max?: string;
  className?: string;
};

export function RangoFechas({ desde, hasta, onDesde, onHasta, max, className = "" }: RangoFechasProps) {
  return (
    <div
      className={`inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition-colors focus-within:border-[#4FAEB2] focus-within:ring-2 focus-within:ring-[#4FAEB2]/15 ${className}`}
    >
      <Campo label="Desde">
        <FechaSelect value={desde} onChange={(e) => onDesde(e.target.value)} max={hasta} className={CAMPO} aria-label="Desde" />
      </Campo>
      <ArrowRight className="mt-3 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
      <Campo label="Hasta">
        <FechaSelect value={hasta} onChange={(e) => onHasta(e.target.value)} min={desde} max={max} className={CAMPO} aria-label="Hasta" />
      </Campo>
    </div>
  );
}

export default RangoFechas;
