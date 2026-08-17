import type { ReactNode } from "react";
import { gsShort } from "@/lib/report/format";

/**
 * Componentes de presentación compartidos por los tableros de reportería
 * (Gerencia comercial, Producción, …). Extraídos de `GerenciaClient.tsx` sin
 * cambios de estilo — el render debe quedar idéntico.
 */

/** Color de marca Neura. */
export const REPORT_TEAL = "#4FAEB2";

export type Tone = "emerald" | "amber" | "rose" | "slate";

export const TONE: Record<Tone, { dot: string; text: string; bg: string; ring: string }> = {
  emerald: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", ring: "border-emerald-200" },
  amber: { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", ring: "border-amber-200" },
  rose: { dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50", ring: "border-rose-200" },
  slate: { dot: "bg-slate-400", text: "text-slate-600", bg: "bg-slate-50", ring: "border-slate-200" },
};

export function Kpi({
  label,
  value,
  sub,
  subColor,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${accent ? "border-[#4FAEB2]/40" : "border-slate-200"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-800">{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${subColor || "text-slate-400"}`}>{sub}</div>}
    </div>
  );
}

export function Metric({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold text-slate-800" title={value}>{value}</div>
      {sub && <div className={`truncate text-[11px] ${subColor || "text-slate-400"}`} title={sub}>{sub}</div>}
    </div>
  );
}

export function Semaforo({ label, tone, detail }: { label: string; tone: Tone; detail: string }) {
  const t = TONE[tone] || TONE.slate;
  return (
    <div className={`flex items-center justify-between rounded-lg border ${t.ring} ${t.bg} px-3 py-2`}>
      <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} /><span className="text-sm font-medium text-slate-700">{label}</span></div>
      <span className={`text-xs font-semibold ${t.text}`}>{detail}</span>
    </div>
  );
}

export function SummaryCard({ title, tone, children }: { title: string; tone: Tone; children: ReactNode }) {
  const t = TONE[tone] || TONE.slate;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </div>
  );
}

/**
 * Barras horizontales de categorías. `labelMap`/`colorMap` permiten mapear el
 * `categoria` crudo a etiqueta/color (Gerencia usa CAT_LABEL/CAT_COLOR; Producción
 * usa el label/color de la etapa de desarrollo). `format` formatea el valor
 * (default: `gsShort`).
 */
export function CategoryBars({
  rows,
  unitLabel = "fact",
  labelMap,
  colorMap,
  format,
}: {
  rows: { categoria: string; facturado: number; facturas: number }[];
  unitLabel?: string;
  labelMap?: Record<string, string>;
  colorMap?: Record<string, string>;
  format?: (n: number) => string;
}) {
  const fmt = format ?? gsShort;
  const max = Math.max(1, ...rows.map((r) => r.facturado));
  if (!rows.length) return <p className="text-sm text-slate-400">Sin datos</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.categoria}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">{labelMap?.[r.categoria] ?? r.categoria}</span>
            <span className="text-slate-500">{fmt(r.facturado)} · {r.facturas} {unitLabel}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${(r.facturado / max) * 100}%`, background: colorMap?.[r.categoria] ?? REPORT_TEAL }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Table({
  title,
  cols,
  rows,
  total,
  empty,
  href,
}: {
  title: string;
  cols: string[];
  rows: string[][];
  total: number;
  empty: string;
  /** Si se pasa, "Ver detalle →" se vuelve un link (ej. al Kanban filtrado). */
  href?: string;
}) {
  const shown = rows.slice(0, 5);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-slate-400">{empty}</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400">{cols.map((c) => <th key={c} className="pb-2 font-medium">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((row, i) => (
                  <tr key={i} className="text-slate-600">{row.map((cell, j) => <td key={j} className={`py-1.5 ${j === 0 ? "font-medium text-slate-700" : ""}`}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 5 && (
            <div className="mt-2 border-t border-slate-100 pt-2 text-right">
              {href ? (
                <a href={href} className="text-xs font-medium text-[#4FAEB2] hover:underline">Mostrando 5 de {total} · Ver detalle →</a>
              ) : (
                <span className="text-xs font-medium text-slate-400">Mostrando 5 de {total} · Ver detalle →</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
