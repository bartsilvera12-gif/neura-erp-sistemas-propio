"use client";

/**
 * Modal de detalle de un proyecto QA. Muestra el AnalizarErpCard
 * (botón Ejecutar sandbox), las credenciales y sección avanzada.
 * Se abre desde el tablero kanban al clickear una card.
 */

import { useEffect } from "react";
import type { QaProjectRow } from "@/lib/qa/db";
import AnalizarErpCard from "./AnalizarErpCard";
import CredencialesProyecto from "./CredencialesProyecto";
import SuitesSection from "./SuitesSection";
import SeccionAvanzado from "./SeccionAvanzado";
import PermiteLecturaToggle from "./PermiteLecturaToggle";
import { EstadoBadge } from "./EstadoProyectoDialogs";
import type { AiEstadoProyecto } from "./QaCenterPanel";

type Props = {
  project: QaProjectRow;
  aiEstado: AiEstadoProyecto | undefined;
  anthropicConfigured: boolean | null;
  credencialesRoRunnerConfigured: boolean | null;
  onClose: () => void;
  onEdit: () => void;
  onAutorizar: () => void;
  onEntregar: () => void;
};

export default function QaProjectDetalleModal({
  project: p,
  aiEstado,
  anthropicConfigured,
  credencialesRoRunnerConfigured,
  onClose,
  onEdit,
  onAutorizar,
  onEntregar,
}: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const repoCorto = p.repo_url?.replace("https://github.com/", "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6"
      data-testid="dlg-proyecto-detalle"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        {/* HEADER con gradiente por estado */}
        <div className={`relative shrink-0 overflow-hidden px-6 py-5 text-white ${
          p.estado_entrega === "entregado"
            ? "bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600"
            : p.estado_entrega === "en_qa"
              ? "bg-gradient-to-br from-sky-700 via-sky-600 to-cyan-600"
              : "bg-gradient-to-br from-slate-700 via-slate-600 to-slate-500"
        }`}>
          <div className="absolute -right-12 -top-16 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">
                NEURA QA Center
              </p>
              <h3 className="mt-0.5 truncate text-xl font-semibold">{p.name}</h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/80">
                <code className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px]">{p.slug}</code>
                <span className="opacity-60">·</span>
                <span>rama <code className="font-mono text-[11px]">{p.default_branch}</code></span>
                <span className="opacity-60">·</span>
                <span>{p.target_env}</span>
                <span className="opacity-60">·</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  p.tipo_proyecto === "web" ? "bg-violet-500/30" : "bg-sky-500/30"
                }`}>
                  {p.tipo_proyecto === "web" ? "Web" : "ERP"}
                </span>
              </p>
              <div className="mt-3">
                <EstadoBadge estado={p.estado_entrega} vence={p.autorizacion_qa_hasta} />
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="shrink-0 rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {/* Info compacta: repo + URL */}
          <div className="relative mt-4 flex flex-wrap items-center gap-2 text-[11px]">
            {repoCorto && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-black/25 px-2 py-1 font-mono text-[10px] text-white">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.2-.8.1-.8.1-.8 1.3.1 2 1.4 2 1.4 1.2 2 3.1 1.4 3.9 1.1.1-.9.5-1.4.9-1.8-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.2-.2-.3-.6-1.6.1-3.3 0 0 1.1-.3 3.5 1.2 1-.3 2.1-.4 3.2-.4s2.2.1 3.2.4c2.4-1.5 3.5-1.2 3.5-1.2.7 1.7.3 3 .1 3.3.8.8 1.3 1.9 1.3 3.2 0 4.7-2.8 5.7-5.5 6 .5.4.9 1.2.9 2.4v3.6c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>
                {repoCorto}
              </span>
            )}
            {p.target_base_url && (
              <a
                href={p.target_base_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-[260px] items-center gap-1.5 truncate rounded-md bg-black/25 px-2 py-1 font-mono text-[10px] text-white hover:bg-black/40"
                title={p.target_base_url}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
                </svg>
                {p.target_base_url.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </div>

        {/* BODY scrolleable */}
        <div className="flex-1 overflow-y-auto overscroll-contain bg-slate-50/40 px-5 py-5">
          <AnalizarErpCard
            projectId={p.id}
            projectSlug={p.slug}
            projectName={p.name}
            lastDiscovery={aiEstado?.lastDiscovery ?? null}
            lastInforme={aiEstado?.lastInforme ?? null}
            totalCostUsd={aiEstado?.totalCostUsd ?? 0}
            cobertura={aiEstado?.cobertura ?? []}
            togglePermiteLectura={p.permite_lectura_sin_env_assert === true}
            anthropicConfigured={anthropicConfigured}
            credencialesRoRunnerConfigured={credencialesRoRunnerConfigured}
          />

          <details className="group/det mt-4 overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/30 transition-colors open:border-indigo-200 open:bg-indigo-50/50">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-indigo-900 transition-colors hover:bg-indigo-100/40">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-indigo-600">
                <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="flex-1">Credenciales QA</span>
              <span className="text-[10px] font-normal text-indigo-700/70">usuario que el agente usa para login</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500 transition-transform group-open/det:rotate-180">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>
            <div className="border-t border-indigo-100 bg-white/60 p-4">
              <CredencialesProyecto projectId={p.id} />
            </div>
          </details>

          <div className="mt-4">
            <SeccionAvanzado>
              <SuitesSection
                projectId={p.id}
                projectSlug={p.slug}
                permiteLecturaSinEnvAssert={p.permite_lectura_sin_env_assert === true}
              />
              <PermiteLecturaToggle
                projectId={p.id}
                initialValue={p.permite_lectura_sin_env_assert === true}
              />
            </SeccionAvanzado>
          </div>
        </div>

        {/* FOOTER con acciones */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
            Editar proyecto
          </button>
          <div className="flex items-center gap-2">
            {p.estado_entrega !== "entregado" && (
              <button
                onClick={onAutorizar}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" />
                </svg>
                {p.estado_entrega === "en_qa" ? "Renovar autorización" : "Autorizar"}
              </button>
            )}
            {p.estado_entrega === "en_qa" && (
              <button
                onClick={onEntregar}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Entregar al cliente
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
