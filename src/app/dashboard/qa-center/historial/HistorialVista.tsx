"use client";

/**
 * Historial cliente: runs agrupados por día con header de fecha tipo
 * timeline, cards ricas con proyecto + barra de aprobación + estado.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

export type RunResumen = {
  id: string;
  status: string;
  duration_ms: number | null;
  totals: Record<string, number>;
  created_at: string;
  project: { id: string; name: string; slug: string; tipo_proyecto: "erp" | "web" } | null;
};

const STATUS_META: Record<string, { label: string; accent: string; bar: string; chip: string; dot: string }> = {
  passed:  { label: "Aprobado",   accent: "border-l-emerald-500", bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",   dot: "bg-emerald-500" },
  failed:  { label: "Con fallas", accent: "border-l-rose-500",    bar: "bg-rose-500",    chip: "bg-rose-50 text-rose-700 ring-rose-200",             dot: "bg-rose-500"    },
  running: { label: "En curso",   accent: "border-l-sky-500",     bar: "bg-sky-500",     chip: "bg-sky-50 text-sky-700 ring-sky-200",                dot: "bg-sky-500 animate-pulse" },
  queued:  { label: "Encolado",   accent: "border-l-slate-400",   bar: "bg-slate-400",   chip: "bg-slate-100 text-slate-700 ring-slate-200",         dot: "bg-slate-400"   },
  aborted: { label: "Abortado",   accent: "border-l-amber-500",   bar: "bg-amber-500",   chip: "bg-amber-50 text-amber-700 ring-amber-200",          dot: "bg-amber-500"   },
  error:   { label: "Error",      accent: "border-l-rose-500",    bar: "bg-rose-500",    chip: "bg-rose-50 text-rose-700 ring-rose-200",             dot: "bg-rose-500"    },
};

function diaDe(iso: string): string {
  return new Date(iso).toLocaleDateString("es-PY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function iniciarMayus(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esHoy(iso: string): boolean {
  const d = new Date(iso);
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString();
}

function esAyer(iso: string): boolean {
  const d = new Date(iso);
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  return d.toDateString() === ayer.toDateString();
}

export default function HistorialVista({ runs }: { runs: RunResumen[] }) {
  const [busqueda, setBusqueda] = useState("");

  const stats = useMemo(() => {
    const total = runs.length;
    const ok = runs.filter((r) => r.status === "passed").length;
    const fail = runs.filter((r) => ["failed", "error", "aborted"].includes(r.status)).length;
    const otros = total - ok - fail;
    return { total, ok, fail, otros };
  }, [runs]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) =>
      r.id.toLowerCase().includes(q) ||
      (r.project?.name.toLowerCase().includes(q) ?? false) ||
      (r.project?.slug.toLowerCase().includes(q) ?? false)
    );
  }, [runs, busqueda]);

  const grupos = useMemo(() => {
    const g: Array<{ dia: string; runs: RunResumen[] }> = [];
    for (const r of filtrados) {
      const key = diaDe(r.created_at);
      const grp = g.find((x) => x.dia === key);
      if (grp) grp.runs.push(r);
      else g.push({ dia: key, runs: [r] });
    }
    return g;
  }, [filtrados]);

  return (
    <div className="mx-auto max-w-6xl">
      {/* HEADER con gradiente */}
      <header className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 via-violet-700 to-fuchsia-600 px-6 py-5 text-white">
        <div className="absolute -right-20 -top-16 h-40 w-40 rounded-full bg-pink-300/20 blur-3xl" />
        <div className="absolute -bottom-20 left-20 h-36 w-36 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-200">NEURA QA Center</p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">Historial</h1>
            <p className="mt-1 text-xs text-white/70 sm:text-sm">
              {runs.length} ejecuciones agrupadas por día — más recientes arriba.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <StatChip label="Total" value={stats.total} tone="white" />
            <StatChip label="Aprobadas" value={stats.ok} tone="emerald" />
            <StatChip label="Con fallas" value={stats.fail} tone="rose" />
            {stats.otros > 0 && <StatChip label="Otros" value={stats.otros} tone="sky" />}
          </div>
        </div>
      </header>

      {/* Buscador */}
      <div className="mb-5 flex items-center justify-end">
        <div className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por proyecto o run…"
            className="w-64 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs placeholder:text-slate-400 focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
            data-testid="historial-busqueda"
          />
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-600">No hay runs que coincidan.</p>
        </div>
      ) : (
        <div className="space-y-6" data-testid="historial-grupos">
          {grupos.map((g, idxG) => {
            const diaIso = g.runs[0]?.created_at ?? "";
            const hoy = esHoy(diaIso);
            const ayer = esAyer(diaIso);
            const okDia = g.runs.filter((r) => r.status === "passed").length;
            const failDia = g.runs.filter((r) => ["failed", "error", "aborted"].includes(r.status)).length;
            return (
              <section
                key={g.dia}
                style={{ animation: `qa-sec-in 280ms ease-out ${Math.min(idxG * 40, 200)}ms both` }}
              >
                <style>{`@keyframes qa-sec-in {from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>

                {/* Header de día con etiqueta HOY/AYER */}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    {hoy && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                        Hoy
                      </span>
                    )}
                    {ayer && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700 ring-1 ring-sky-200">
                        Ayer
                      </span>
                    )}
                    <h2 className="text-sm font-semibold text-slate-900">{iniciarMayus(g.dia)}</h2>
                  </div>
                  <span className="text-slate-300">·</span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    <span className="font-semibold text-slate-700">{g.runs.length}</span> runs
                    {okDia > 0 && (
                      <>
                        <span className="text-slate-300"> · </span>
                        <span className="text-emerald-600">{okDia} ok</span>
                      </>
                    )}
                    {failDia > 0 && (
                      <>
                        <span className="text-slate-300"> · </span>
                        <span className="text-rose-600">{failDia} fail</span>
                      </>
                    )}
                  </span>
                </div>

                <ul className="space-y-2">
                  {g.runs.map((r, idx) => (
                    <RunCard key={r.id} run={r} index={idx} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: "white" | "emerald" | "rose" | "sky" }) {
  const toneCls = {
    white:   "bg-white/15 ring-white/25 text-white",
    emerald: "bg-emerald-400/20 ring-emerald-300/40 text-emerald-100",
    rose:    "bg-rose-400/20 ring-rose-300/40 text-rose-100",
    sky:     "bg-sky-400/20 ring-sky-300/40 text-sky-100",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ${toneCls}`}>
      <span className="text-[10px] uppercase tracking-wide opacity-80">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

function RunCard({ run: r, index }: { run: RunResumen; index: number }) {
  const meta = STATUS_META[r.status] ?? STATUS_META.queued;
  const t = r.totals;
  const passed = Number(t.passed ?? 0);
  const failed = Number(t.failed ?? 0);
  const skipped = Number(t.skipped ?? 0);
  const total = passed + failed + skipped;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

  const projName = r.project?.name ?? "Proyecto eliminado";
  const projSlug = r.project?.slug ?? "—";
  const tipo = r.project?.tipo_proyecto ?? "erp";

  return (
    <li
      className={`group overflow-hidden rounded-xl border border-slate-200 border-l-4 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#0EA5E9]/60 hover:shadow-md ${meta.accent}`}
      style={{ animation: `qa-row-in 240ms ease-out ${Math.min(index * 25, 300)}ms both` }}
    >
      <style>{`@keyframes qa-row-in {from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <Link href={`/dashboard/qa-center/runs/${r.id}`} className="flex flex-col gap-3 p-3.5 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-[2] items-start gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${meta.chip}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900" title={projName}>{projName}</h3>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${
                tipo === "web" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-sky-50 text-sky-700 ring-sky-200"
              }`}>
                {tipo === "web" ? "Web" : "ERP"}
              </span>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10px] text-slate-500">
              <span>{projSlug}</span>
              <span className="text-slate-300">·</span>
              <span>run {r.id.slice(0, 8)}</span>
            </p>
          </div>
        </div>

        <div className="flex-1">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-semibold text-slate-700 tabular-nums">
              {passed}/{total || "—"}
            </span>
            <span className="text-slate-500">{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${meta.bar}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {failed > 0 && <span className="font-semibold text-rose-600">{failed} fail</span>}
            {failed > 0 && skipped > 0 && <span className="text-slate-300"> · </span>}
            {skipped > 0 && <span>{skipped} skip</span>}
            {failed === 0 && skipped === 0 && total > 0 && <span className="text-emerald-600">todo verde</span>}
          </p>
        </div>

        <div className="hidden text-right text-[11px] md:block">
          <p className="font-medium text-slate-700">
            {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"}
          </p>
          <p className="text-slate-500">
            {new Date(r.created_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors group-hover:bg-[#0EA5E9]">
          Ver
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </Link>
    </li>
  );
}
