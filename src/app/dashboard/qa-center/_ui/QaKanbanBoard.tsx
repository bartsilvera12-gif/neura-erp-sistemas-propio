"use client";

/**
 * Tablero kanban estilo CRM del QA Center.
 * 3 columnas por estado_entrega, cards con color según el estado, click
 * en la card abre el modal de detalle con "Ejecutar sandbox".
 */

import { useMemo, useState, type ReactElement, type MouseEvent as ReactMouseEvent } from "react";
import type { QaProjectRow } from "@/lib/qa/db";
import BotonEjecutarRapido from "./BotonEjecutarRapido";

type Estado = "en_desarrollo" | "en_qa" | "entregado";

type Theme = {
  id: Estado;
  label: string;
  headerBg: string;
  headerText: string;
  columnBg: string;
  dot: string;
  cardAccent: string;
  countPill: string;
  icon: ReactElement;
};

const COLUMNAS: Theme[] = [
  {
    id: "en_desarrollo",
    label: "En desarrollo",
    headerBg: "bg-gradient-to-r from-slate-600 to-slate-500",
    headerText: "text-white",
    columnBg: "bg-gradient-to-b from-slate-50 to-white",
    dot: "bg-slate-300",
    cardAccent: "before:bg-slate-400",
    countPill: "bg-white/20 text-white",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    ),
  },
  {
    id: "en_qa",
    label: "En QA",
    headerBg: "bg-gradient-to-r from-sky-600 to-cyan-500",
    headerText: "text-white",
    columnBg: "bg-gradient-to-b from-sky-50 to-white",
    dot: "bg-cyan-200",
    cardAccent: "before:bg-sky-500",
    countPill: "bg-white/25 text-white",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  {
    id: "entregado",
    label: "Entregado",
    headerBg: "bg-gradient-to-r from-emerald-600 to-teal-500",
    headerText: "text-white",
    columnBg: "bg-gradient-to-b from-emerald-50 to-white",
    dot: "bg-emerald-200",
    cardAccent: "before:bg-emerald-500",
    countPill: "bg-white/25 text-white",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
];

type Props = {
  projects: QaProjectRow[];
  onOpen: (projectId: string) => void;
  onArchived?: () => void;
};

export default function QaKanbanBoard({ projects, onOpen, onArchived }: Props) {
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
    const g: Record<Estado, QaProjectRow[]> = { en_desarrollo: [], en_qa: [], entregado: [] };
    for (const p of filtrados) {
      const e = (p.estado_entrega ?? "en_desarrollo") as Estado;
      (g[e] ?? g.en_desarrollo).push(p);
    }
    // Orden por nombre dentro de cada columna
    for (const k of Object.keys(g) as Estado[]) {
      g[k].sort((a, b) => a.name.localeCompare(b.name, "es"));
    }
    return g;
  }, [filtrados]);

  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Tablero de proyectos</h2>
          <p className="text-xs text-slate-500">
            Clic en una card para ejecutar el sandbox, ver credenciales, suites y resultados.
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
            <div
              key={col.id}
              className={`flex min-h-[260px] flex-col overflow-hidden rounded-xl border border-slate-200 shadow-sm ${col.columnBg}`}
            >
              <header className={`flex items-center justify-between ${col.headerBg} px-3 py-2 shadow-inner ${col.headerText}`}>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <span className="opacity-90">{col.icon}</span>
                  {col.label}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-white/30 ${col.countPill}`}>
                  {items.length}
                </span>
              </header>

              <div className="flex-1 space-y-2 p-2" data-testid={`kanban-col-${col.id}`}>
                {items.length === 0 ? (
                  <div className="flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-white/60 text-[11px] text-slate-400">
                    Sin proyectos
                  </div>
                ) : (
                  items.map((p) => (
                    <KanbanCard
                      key={p.id}
                      project={p}
                      accent={col.cardAccent}
                      onOpen={() => onOpen(p.id)}
                      onArchived={onArchived}
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
  accent,
  onOpen,
  onArchived,
}: {
  project: QaProjectRow;
  accent: string;
  onOpen: () => void;
  onArchived?: () => void;
}) {
  const [archivando, setArchivando] = useState(false);
  const [errArch, setErrArch] = useState<string | null>(null);
  const repoCorto = p.repo_url?.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  const urlCorta = (p.target_base_url ?? "").replace(/^https?:\/\/(www\.)?/, "");

  async function archivar(e: ReactMouseEvent): Promise<void> {
    e.stopPropagation();
    if (archivando) return;
    const ok = window.confirm(
      `¿Eliminar "${p.name}" del tablero?\n\nSe archiva (soft-delete): deja de aparecer pero los datos quedan en DB.`
    );
    if (!ok) return;
    setArchivando(true); setErrArch(null);
    try {
      const res = await fetch(`/api/qa/projects/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrArch(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (onArchived) onArchived();
      else window.location.reload();
    } catch (err) {
      setErrArch(err instanceof Error ? err.message : "error de red");
    } finally {
      setArchivando(false);
    }
  }

  return (
    <article
      className={`group relative cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white p-3 pl-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#0EA5E9]/50 hover:shadow-md before:absolute before:inset-y-0 before:left-0 before:w-1.5 ${accent}`}
      data-testid={`kanban-card-${p.slug}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      tabIndex={0}
      role="button"
      aria-label={`Abrir detalle de ${p.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900" title={p.name}>
            {p.name}
          </h3>
          <p className="truncate font-mono text-[10px] text-slate-500">{p.slug}</p>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${
            p.tipo_proyecto === "web"
              ? "bg-violet-50 text-violet-700 ring-violet-200"
              : "bg-sky-50 text-sky-700 ring-sky-200"
          }`}>
            {p.tipo_proyecto === "web" ? "Web" : "ERP"}
          </span>
          <button
            onClick={archivar}
            disabled={archivando}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            title="Eliminar del tablero (soft-delete)"
            aria-label={`Eliminar ${p.name} del tablero`}
            data-testid={`kanban-del-${p.slug}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      {errArch && (
        <p className="mt-1 text-[10px] text-rose-700" onClick={(e) => e.stopPropagation()}>
          No se pudo archivar: {errArch}
        </p>
      )}

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

      {/* Botón sandbox — no propaga el click a la card */}
      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <BotonEjecutarRapido projectId={p.id} projectSlug={p.slug} />
      </div>
    </article>
  );
}
