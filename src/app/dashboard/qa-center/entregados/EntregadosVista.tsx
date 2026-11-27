"use client";

/**
 * Vista cliente de ERPs entregados: header verde con stats, buscador,
 * cards con color de acento y animación de entrada en cascada.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

export type EntregadoRow = {
  id: string;
  name: string;
  slug: string;
  repo_url: string | null;
  target_base_url: string;
  tipo_proyecto?: "erp" | "web";
  autorizacion_qa_hasta: string | null;
};

export default function EntregadosVista({ entregados }: { entregados: EntregadoRow[] }) {
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return entregados;
    return entregados.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      (p.repo_url ?? "").toLowerCase().includes(q) ||
      (p.target_base_url ?? "").toLowerCase().includes(q)
    );
  }, [entregados, busqueda]);

  const stats = {
    total: entregados.length,
    erp: entregados.filter((p) => (p.tipo_proyecto ?? "erp") === "erp").length,
    web: entregados.filter((p) => p.tipo_proyecto === "web").length,
  };

  return (
    <div className="mx-auto max-w-6xl">
      {/* HEADER verde */}
      <header className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-500 px-6 py-5 text-white">
        <div className="absolute -right-20 -top-16 h-40 w-40 rounded-full bg-teal-300/20 blur-3xl" />
        <div className="absolute -bottom-20 left-20 h-36 w-36 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">NEURA QA Center</p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">ERPs entregados</h1>
            <p className="mt-1 text-xs text-white/70 sm:text-sm">
              Proyectos que pasaron QA y fueron entregados al cliente.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <StatChip label="Total" value={stats.total} tone="white" />
            <StatChip label="ERP" value={stats.erp} tone="sky" />
            <StatChip label="Web" value={stats.web} tone="violet" />
          </div>
        </div>
      </header>

      {/* Buscador */}
      <div className="mb-4 flex items-center justify-end">
        <div className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por proyecto, repo, URL…"
            className="w-64 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs placeholder:text-slate-400 focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
            data-testid="entregados-busqueda"
          />
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><path d="m9 11 2 2 4-4" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-800">Todavía no hay ERPs entregados</p>
          <p className="mt-1 text-xs text-slate-500">
            Cuando marques un proyecto como entregado desde el tablero, aparece acá.
          </p>
          <Link
            href="/dashboard/qa-center"
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            Ver proyectos
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="entregados-grid">
          {filtrados.map((p, i) => (
            <EntregadoCard key={p.id} entregado={p} index={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: "white" | "sky" | "violet" }) {
  const toneCls = {
    white:  "bg-white/15 ring-white/25 text-white",
    sky:    "bg-sky-400/20 ring-sky-300/40 text-sky-100",
    violet: "bg-violet-400/20 ring-violet-300/40 text-violet-100",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ${toneCls}`}>
      <span className="text-[10px] uppercase tracking-wide opacity-80">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

function EntregadoCard({ entregado: p, index }: { entregado: EntregadoRow; index: number }) {
  const repoCorto = p.repo_url?.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  const urlCorta = (p.target_base_url ?? "").replace(/^https?:\/\/(www\.)?/, "");
  const tipo = p.tipo_proyecto ?? "erp";
  return (
    <li
      className="group relative overflow-hidden rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md"
      style={{ animation: `qa-ent-in 240ms ease-out ${Math.min(index * 30, 300)}ms both` }}
    >
      <style>{`@keyframes qa-ent-in {from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900" title={p.name}>{p.name}</h3>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${
              tipo === "web" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-sky-50 text-sky-700 ring-sky-200"
            }`}>
              {tipo === "web" ? "Web" : "ERP"}
            </span>
          </div>
          <p className="truncate font-mono text-[10px] text-slate-500">{p.slug}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Entregado
        </span>
      </div>

      {(repoCorto || urlCorta) && (
        <div className="mt-3 space-y-1">
          {repoCorto && (
            <p className="truncate font-mono text-[10px] text-slate-500" title={repoCorto}>
              <span className="text-slate-400">github</span> · {repoCorto}
            </p>
          )}
          {urlCorta && (
            <p className="truncate font-mono text-[10px] text-slate-500" title={urlCorta}>
              <span className="text-slate-400">url</span> · {urlCorta}
            </p>
          )}
        </div>
      )}

      {p.autorizacion_qa_hasta && (
        <p className="mt-2 text-[10px] text-slate-500">
          Fecha de entrega{" "}
          <span className="font-medium text-slate-700">
            {new Date(p.autorizacion_qa_hasta).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </p>
      )}
    </li>
  );
}
