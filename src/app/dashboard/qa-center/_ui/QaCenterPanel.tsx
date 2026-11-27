"use client";

/**
 * NEURA QA CENTER — vista principal.
 *
 * Diseño: header con gradiente Neura, cards de proyecto separadas con
 * hover sutil, botones con íconos y tono según semántica.
 * Mantiene exactamente la misma funcionalidad que antes (crear/editar/
 * autorizar/entregar/ejecutar); sólo cambia el layout y el estilo.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { QaListResult, QaProjectRow, QaRunRow } from "@/lib/qa/db";
import type { CoberturaModulo } from "./CoberturaIAViewer";
import QaKanbanBoard from "./QaKanbanBoard";
import QaProjectDetalleModal from "./QaProjectDetalleModal";
import NuevoProyectoDialog from "./NuevoProyectoDialog";
import EditarProyectoDialog from "./EditarProyectoDialog";
import SuitesSection from "./SuitesSection";
import AnalizarErpCard from "./AnalizarErpCard";
import CredencialesProyecto from "./CredencialesProyecto";
import SeccionAvanzado from "./SeccionAvanzado";
import PermiteLecturaToggle from "./PermiteLecturaToggle";
import { AutorizarDialog, EntregarDialog, EstadoBadge } from "./EstadoProyectoDialogs";

export type AiEstadoProyecto = {
  projectId: string;
  totalCostUsd: number;
  cobertura: CoberturaModulo[];
  lastDiscovery: {
    created_at: string;
    modulos: Array<{ nombre: string; totalRutas?: number }> | null;
    totales: Record<string, number> | null;
  } | null;
  lastInforme: {
    resumen: string;
    modulos: Array<{
      nombre: string;
      funciona_bien?: string[];
      fallas?: Array<{
        funcion_revisada?: string;
        resultado_esperado?: string;
        resultado_obtenido?: string;
        recomendacion?: string;
      }>;
      pendientes?: Array<{ funcion_revisada?: string; motivo?: string }>;
    }>;
    parcial?: boolean;
    created_at: string;
  } | null;
};

type Props = {
  projects: QaListResult<QaProjectRow>;
  runs: QaListResult<QaRunRow>;
  aiEstado?: Record<string, AiEstadoProyecto>;
  anthropicConfigured?: boolean | null;
  credencialesRoRunnerConfigured?: boolean | null;
};

export default function QaCenterPanel({
  projects,
  runs,
  aiEstado = {},
  anthropicConfigured = null,
  credencialesRoRunnerConfigured = null,
}: Props) {
  const migrationPending =
    projects.migration_status !== "ready" || runs.migration_status !== "ready";

  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [autorizandoId, setAutorizandoId] = useState<string | null>(null);
  const [entregandoId, setEntregandoId] = useState<string | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const editing = editingId ? projects.data.find((p) => p.id === editingId) ?? null : null;
  const autorizando = autorizandoId ? projects.data.find((p) => p.id === autorizandoId) ?? null : null;
  const entregando = entregandoId ? projects.data.find((p) => p.id === entregandoId) ?? null : null;
  const detalle = detalleId ? projects.data.find((p) => p.id === detalleId) ?? null : null;

  const router = useRouter();
  // Refresca los datos del servidor SIN recargar la página: Next.js
  // re-ejecuta los server components y la UI se actualiza en su lugar.
  // Mantiene el scroll y el estado de los modales/formularios abiertos.
  const reload = (): void => { router.refresh(); };

  const totalProyectos = projects.data.length;
  const totalEntregados = projects.data.filter((p) => p.estado_entrega === "entregado").length;
  const totalEnQa = projects.data.filter((p) => p.estado_entrega === "en_qa").length;

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Header con gradiente Neura */}
      <header className="relative overflow-hidden bg-gradient-to-br from-[#0B3A3D] via-[#104A4E] to-[#285C62] text-white">
        <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-[#7DCFD2]/10 blur-3xl" />
        <div className="absolute -bottom-40 left-20 h-72 w-72 rounded-full bg-[#0EA5E9]/10 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 py-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                </span>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">QA Center</h1>
                  <p className="text-xs text-white/70 sm:text-sm">
                    Panel de QA Desarrollo · nunca ejecuta contra producción.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
                <HeaderChip label="Proyectos" value={String(totalProyectos)} />
                <HeaderChip label="En QA" value={String(totalEnQa)} tone="sky" />
                <HeaderChip label="Entregados" value={String(totalEntregados)} tone="emerald" />
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                onClick={() => setShowNew(true)}
                data-testid="btn-nuevo-proyecto"
                className="group inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-medium text-white backdrop-blur transition-all hover:bg-white/20"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:rotate-90">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Nuevo proyecto
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {migrationPending && <MigrationPendingBanner projects={projects} runs={runs} />}

        {projects.data.length === 0 ? (
          <section className="mb-8">
            <EmptyProjectsState onNew={() => setShowNew(true)} />
          </section>
        ) : (
          <QaKanbanBoard
            projects={projects.data}
            onOpen={(id) => setDetalleId(id)}
            onAutorizar={(id) => setAutorizandoId(id)}
            onEntregar={(id) => setEntregandoId(id)}
            onArchived={reload}
          />
        )}

        {runs.data.length > 0 && (
          <section className="mt-4 overflow-hidden rounded-xl border border-[#7DCFD2]/30 bg-gradient-to-r from-[#7DCFD2]/10 via-white to-white">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0B3A3D] text-white">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </span>
              <p className="flex-1 text-sm text-slate-700">
                Hay <strong className="font-semibold text-slate-900">{runs.data.length}</strong> ejecucion(es) recientes.
              </p>
              <div className="flex gap-2">
                <Link
                  href="/dashboard/qa-center/resultados"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-[#0EA5E9]/40 hover:text-[#0EA5E9]"
                >
                  Resultados
                </Link>
                <Link
                  href="/dashboard/qa-center/historial"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-[#0EA5E9]/40 hover:text-[#0EA5E9]"
                >
                  Historial
                </Link>
              </div>
            </div>
          </section>
        )}
      </main>

      {showNew && (
        <NuevoProyectoDialog
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); reload(); }}
        />
      )}
      {editing && (
        <EditarProyectoDialog
          project={editing}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); reload(); }}
        />
      )}
      {autorizando && (
        <AutorizarDialog
          projectId={autorizando.id}
          onClose={() => setAutorizandoId(null)}
          onDone={() => { setAutorizandoId(null); reload(); }}
        />
      )}
      {entregando && (
        <EntregarDialog
          projectId={entregando.id}
          projectName={entregando.name}
          onClose={() => setEntregandoId(null)}
          onDone={() => { setEntregandoId(null); reload(); }}
        />
      )}
      {detalle && (
        <QaProjectDetalleModal
          project={detalle}
          aiEstado={aiEstado[detalle.id]}
          anthropicConfigured={anthropicConfigured}
          credencialesRoRunnerConfigured={credencialesRoRunnerConfigured}
          onClose={() => setDetalleId(null)}
          onEdit={() => { setDetalleId(null); setEditingId(detalle.id); }}
          onAutorizar={() => { setDetalleId(null); setAutorizandoId(detalle.id); }}
          onEntregar={() => { setDetalleId(null); setEntregandoId(detalle.id); }}
        />
      )}
    </div>
  );
}

function HeaderChip({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "sky" | "emerald" }) {
  const toneCls = {
    slate:   "bg-white/10 ring-white/15 text-white/90",
    sky:     "bg-sky-400/15 ring-sky-300/30 text-sky-100",
    emerald: "bg-emerald-400/15 ring-emerald-300/30 text-emerald-100",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ${toneCls}`}>
      <span className="text-[10px] uppercase tracking-wide opacity-80">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

function EmptyProjectsState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white px-6 py-14 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#7DCFD2]/15 text-[#0B3A3D]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-slate-800">Todavía no hay proyectos cargados</p>
      <p className="mt-1 text-xs text-slate-500">Registrá el primer ERP y empezá a correr QA en minutos.</p>
      <button
        onClick={onNew}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#0EA5E9] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0284C7]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Nuevo proyecto
      </button>
    </div>
  );
}

function ProjectCard({
  project: p,
  aiEstado,
  anthropicConfigured,
  credencialesRoRunnerConfigured,
  onEdit,
  onAutorizar,
  onEntregar,
}: {
  project: QaProjectRow;
  aiEstado: AiEstadoProyecto | undefined;
  anthropicConfigured: boolean | null;
  credencialesRoRunnerConfigured: boolean | null;
  onEdit: () => void;
  onAutorizar: () => void;
  onEntregar: () => void;
}) {
  const repoCorto = p.repo_url?.replace("https://github.com/", "");
  const esPrivado = Boolean(repoCorto); // No tenemos flag privado directo: mostramos chip marca github.
  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:border-[#7DCFD2]/50 hover:shadow-md">
      <div className="flex flex-wrap items-start gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-slate-50 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0B3A3D] to-[#285C62] text-white shadow-sm ring-1 ring-black/5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" fillOpacity="0.2"/>
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-slate-900">{p.name}</h3>
              {esPrivado && (
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 6h8V4a4 4 0 1 0-8 0v2zm10 2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z"/></svg>
                  privado
                </span>
              )}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{p.slug}</code>
              <span className="text-slate-300">·</span>
              <span>rama <code className="font-mono text-[11px] text-slate-700">{p.default_branch}</code></span>
              <span className="text-slate-300">·</span>
              <span>{p.target_env}</span>
            </p>
            {repoCorto && (
              <p className="mt-1.5 text-xs" data-testid={`repo-chip-${p.slug}`}>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900/90 px-2 py-0.5 font-mono text-[10px] text-slate-100">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.2-.8.1-.8.1-.8 1.3.1 2 1.4 2 1.4 1.2 2 3.1 1.4 3.9 1.1.1-.9.5-1.4.9-1.8-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.2-.2-.3-.6-1.6.1-3.3 0 0 1.1-.3 3.5 1.2 1-.3 2.1-.4 3.2-.4s2.2.1 3.2.4c2.4-1.5 3.5-1.2 3.5-1.2.7 1.7.3 3 .1 3.3.8.8 1.3 1.9 1.3 3.2 0 4.7-2.8 5.7-5.5 6 .5.4.9 1.2.9 2.4v3.6c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>
                  {repoCorto}
                </span>
              </p>
            )}
            <div className="mt-2">
              <EstadoBadge estado={p.estado_entrega} vence={p.autorizacion_qa_hasta} />
            </div>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col items-end gap-2 sm:w-auto">
          {p.target_base_url ? (
            <a
              href={p.target_base_url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/url inline-flex max-w-full items-center gap-1.5 truncate rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-200"
              title={p.target_base_url}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
              </svg>
              <span className="truncate font-mono">{p.target_base_url.replace(/^https?:\/\//, "")}</span>
            </a>
          ) : (
            <span className="rounded-md bg-amber-50 px-2.5 py-1 text-xs text-amber-700 ring-1 ring-amber-200" title="Proyecto sólo de análisis de repositorio">
              sin URL cargada
            </span>
          )}
          <div className="flex gap-1.5">
            {p.estado_entrega !== "entregado" && (
              <button
                onClick={onAutorizar}
                data-testid={`btn-autorizar-${p.slug}`}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 transition-all hover:border-emerald-400 hover:bg-emerald-50"
                title="Firmar autorización de QA Desarrollo por 72h"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" />
                </svg>
                {p.estado_entrega === "en_qa" ? "Renovar" : "Autorizar"}
              </button>
            )}
            {p.estado_entrega !== "entregado" && (
              <button
                onClick={onEntregar}
                data-testid={`btn-entregar-${p.slug}`}
                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-all hover:border-red-400 hover:bg-red-50"
                title="Marcar como entregado al cliente (bloqueo total de QA)"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Entregar
              </button>
            )}
            <button
              onClick={onEdit}
              data-testid={`btn-editar-${p.slug}`}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
              Editar
            </button>
          </div>
        </div>
      </div>

      <div className="p-5">
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
            <p className="mb-3 text-xs text-slate-600">
              Cargá un usuario de solo-lectura. El agente IA lo usa cuando apretás <strong>Ejecutar sandbox</strong>. El password se cifra server-side y nunca vuelve a mostrarse.
            </p>
            <CredencialesProyecto projectId={p.id} />
          </div>
        </details>

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
    </article>
  );
}

function MigrationPendingBanner({
  projects, runs,
}: { projects: QaListResult<QaProjectRow>; runs: QaListResult<QaRunRow> }) {
  const notes = [projects.note, runs.note].filter((n): n is string => Boolean(n));
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">Panel operativo, datos aún no disponibles</p>
          <p className="mt-0.5 text-xs text-amber-800">
            El panel no simula información. Pasos pendientes:
          </p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-xs text-amber-800">
            <li>Aplicar <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">20261112000000_qa_center_schema.sql</code></li>
            <li>Agregar <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">&quot;qa_center&quot;</code> a <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[10px]">schemas</code> y recargar</li>
            <li>Crear el primer proyecto con &quot;Nuevo proyecto&quot;</li>
          </ol>
          {notes.length > 0 && <p className="mt-2 text-[11px] text-amber-700">Detalle: {notes.join(" · ")}</p>}
        </div>
      </div>
    </div>
  );
}
