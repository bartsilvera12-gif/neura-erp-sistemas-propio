"use client";

/**
 * Vista kanban del QA Center estilo CRM: 3 columnas por estado_entrega
 * (En desarrollo · En QA · Entregado), con cards compactas. El detalle
 * completo del proyecto se abre en un drawer lateral.
 */

import { useMemo, useState } from "react";
import type { QaProjectRow } from "@/lib/qa/db";
import EjecutarQaButton from "./EjecutarQaButton";

type Estado = "en_desarrollo" | "en_qa" | "entregado";

const COLUMNAS: Array<{ id: Estado; label: string; dot: string; headerBg: string; headerText: string }> = [
  { id: "en_desarrollo", label: "En desarrollo", dot: "bg-slate-400", headerBg: "bg-slate-50", headerText: "text-slate-700" },
  { id: "en_qa",         label: "En QA",         dot: "bg-sky-500",   headerBg: "bg-sky-50",   headerText: "text-sky-800" },
  { id: "entregado",     label: "Entregado",     dot: "bg-emerald-500", headerBg: "bg-emerald-50", headerText: "text-emerald-800" },
];

type Props = {
  projects: QaProjectRow[];
  onEdit: (projectId: string) => void;
  onAutorizar: (projectId: string) => void;
  onEntregar: (projectId: string) => void;
};

export default function QaKanbanBoard({ projects, onEdit, onAutorizar, onEntregar }: Props) {
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      (p.repo_url ?? "").toLowerCase().includes(q) ||
      (p.target_base_url ?? "").toLowerCase().includes(q)
    );
  }, [projects, busqueda]);

  const porColumna: Record<Estado, QaProjectRow[]> = useMemo(() => {
    const groups: Record<Estado, QaProjectRow[]> = { en_desarrollo: [], en_qa: [], entregado: [] };
    for (const p of filtrados) {
      const e = (p.estado_entrega ?? "en_desarrollo") as Estado;
      if (!groups[e]) groups[e] = [];
      groups[e].push(p);
    }
    return groups;
  }, [filtrados]);

  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Tablero de proyectos</h2>
          <p className="text-xs text-slate-500">
            Arrastrá la mirada por las 3 columnas para ver cada proyecto por etapa.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar proyecto, repo, URL…"
              className="w-60 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs placeholder:text-slate-400 focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
              data-testid="kanban-busqueda"
            />
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {filtrados.length} {filtrados.length === 1 ? "proyecto" : "proyectos"}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3" data-testid="kanban-columnas">
        {COLUMNAS.map((col) => {
          const items = porColumna[col.id] ?? [];
          return (
            <div key={col.id} className="flex min-h-[220px] flex-col rounded-xl border border-slate-200 bg-slate-50/40">
              <header className={`flex items-center justify-between rounded-t-xl ${col.headerBg} px-3 py-2`}>
                <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${col.headerText}`}>
                  <span className={`inline-block h-2 w-2 rounded-full ${col.dot}`} />
                  {col.label}
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                  {items.length}
                </span>
              </header>

              <div className="flex-1 space-y-2 p-2" data-testid={`kanban-col-${col.id}`}>
                {items.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-[11px] text-slate-400">
                    Sin proyectos
                  </div>
                ) : (
                  items.map((p) => (
                    <KanbanCard
                      key={p.id}
                      project={p}
                      onEdit={() => onEdit(p.id)}
                      onAutorizar={() => onAutorizar(p.id)}
                      onEntregar={() => onEntregar(p.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function KanbanCard({
  project: p,
  onEdit,
  onAutorizar,
  onEntregar,
}: {
  project: QaProjectRow;
  onEdit: () => void;
  onAutorizar: () => void;
  onEntregar: () => void;
}) {
  const repoCorto = p.repo_url?.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  const urlCorta = (p.target_base_url ?? "").replace(/^https?:\/\/(www\.)?/, "");
  const esEntregado = p.estado_entrega === "entregado";
  const esEnQa = p.estado_entrega === "en_qa";
  return (
    <article
      className="group rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#0EA5E9]/40 hover:shadow-md"
      data-testid={`kanban-card-${p.slug}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900" title={p.name}>
            {p.name}
          </h3>
          <p className="truncate font-mono text-[10px] text-slate-500">{p.slug}</p>
        </div>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${
          p.tipo_proyecto === "web"
            ? "bg-violet-50 text-violet-700 ring-violet-200"
            : "bg-sky-50 text-sky-700 ring-sky-200"
        }`}>
          {p.tipo_proyecto === "web" ? "Web" : "ERP"}
        </span>
      </div>

      {(repoCorto || urlCorta) && (
        <div className="mt-2 space-y-1">
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
          Autorizado hasta{" "}
          <span className="font-medium text-slate-700">
            {new Date(p.autorizacion_qa_hasta).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
          </span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <EjecutarQaButton projects={[p]} />
        <button
          onClick={onEdit}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-100"
          data-testid={`kanban-edit-${p.slug}`}
        >
          Editar
        </button>
        {!esEntregado && (
          <button
            onClick={esEnQa ? onEntregar : onAutorizar}
            className={`rounded px-2 py-1 text-[10px] font-medium ring-1 ${
              esEnQa
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
                : "bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100"
            }`}
            data-testid={`kanban-avanzar-${p.slug}`}
          >
            {esEnQa ? "Entregar" : "Autorizar"}
          </button>
        )}
      </div>
    </article>
  );
}
