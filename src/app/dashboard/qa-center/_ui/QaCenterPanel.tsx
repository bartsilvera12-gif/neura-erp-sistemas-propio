"use client";

/**
 * NEURA QA CENTER — vista principal.
 *
 * Datos iniciales llegan del server component (projects, runs). La UI agrega
 * acciones: nuevo/editar proyecto, gestionar suites, encolar run, ver detalle.
 */

import Link from "next/link";
import { useState } from "react";
import type { QaListResult, QaProjectRow, QaRunRow } from "@/lib/qa/db";
import type { QaFindingRow } from "@/lib/qa/repo-types";
import type { CoberturaModulo } from "./CoberturaIAViewer";
import EjecutarQaButton from "./EjecutarQaButton";
import NuevoProyectoDialog from "./NuevoProyectoDialog";
import EditarProyectoDialog from "./EditarProyectoDialog";
import SuitesSection from "./SuitesSection";
import AnalizarErpCard from "./AnalizarErpCard";
import SeccionAvanzado from "./SeccionAvanzado";
import FindingsSection from "./FindingsSection";
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
  findings?: QaFindingRow[];
  aiEstado?: Record<string, AiEstadoProyecto>;
  anthropicConfigured?: boolean | null;
  credencialesRoRunnerConfigured?: boolean | null;
};

export default function QaCenterPanel({
  projects,
  runs,
  findings,
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
  const editing = editingId ? projects.data.find((p) => p.id === editingId) ?? null : null;
  const autorizando = autorizandoId ? projects.data.find((p) => p.id === autorizandoId) ?? null : null;
  const entregando = entregandoId ? projects.data.find((p) => p.id === entregandoId) ?? null : null;

  const reload = (): void => { window.location.reload(); };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">QA Center</h1>
          <p className="text-sm text-slate-500">
            Panel de QA Desarrollo. Nunca ejecuta contra producción.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNew(true)}
            data-testid="btn-nuevo-proyecto"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
          >
            + Nuevo proyecto
          </button>
          <EjecutarQaButton
            projects={projects.data}
            disabled={projects.migration_status !== "ready"}
          />
        </div>
      </header>

      {migrationPending && <MigrationPendingBanner projects={projects} runs={runs} />}

      <section className="mb-8">
        <SectionHeader title="Proyectos" subtitle="Cada proyecto representa un ERP bajo QA." />
        {projects.data.length === 0 ? (
          <EmptyState
            title="Todavía no hay proyectos cargados"
            hint='Hacé clic en "+ Nuevo proyecto" para registrar el primero.'
          />
        ) : (
          <ul className="divide-y rounded-lg border bg-white" data-testid="lista-proyectos">
            {projects.data.map((p) => (
              <li key={p.id} className="px-4 py-3" data-testid={`row-proy-${p.slug}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.slug} · branch {p.default_branch} · {p.target_env}
                    </p>
                    <p className="mt-1">
                      <EstadoBadge estado={p.estado_entrega} vence={p.autorizacion_qa_hasta} />
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
                      {p.target_base_url}
                    </span>
                    {p.estado_entrega !== "entregado" && (
                      <button
                        onClick={() => setAutorizandoId(p.id)}
                        data-testid={`btn-autorizar-${p.slug}`}
                        className="rounded border border-emerald-600 bg-white px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                        title="Firmar autorización de QA Desarrollo por 72h"
                      >
                        {p.estado_entrega === "en_qa" ? "Renovar QA" : "Autorizar QA"}
                      </button>
                    )}
                    {p.estado_entrega !== "entregado" && (
                      <button
                        onClick={() => setEntregandoId(p.id)}
                        data-testid={`btn-entregar-${p.slug}`}
                        className="rounded border border-red-600 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        title="Marcar como entregado al cliente (bloqueo total de QA)"
                      >
                        Entregar
                      </button>
                    )}
                    <button
                      onClick={() => setEditingId(p.id)}
                      data-testid={`btn-editar-${p.slug}`}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
                    >
                      Editar
                    </button>
                  </div>
                </div>
                <AnalizarErpCard
                  projectId={p.id}
                  projectSlug={p.slug}
                  projectName={p.name}
                  lastDiscovery={aiEstado[p.id]?.lastDiscovery ?? null}
                  lastInforme={aiEstado[p.id]?.lastInforme ?? null}
                  totalCostUsd={aiEstado[p.id]?.totalCostUsd ?? 0}
                  cobertura={aiEstado[p.id]?.cobertura ?? []}
                  togglePermiteLectura={p.permite_lectura_sin_env_assert === true}
                  anthropicConfigured={anthropicConfigured}
                  credencialesRoRunnerConfigured={credencialesRoRunnerConfigured}
                />
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <FindingsSection initial={findings} />

      <section>
        <SectionHeader title="Últimas ejecuciones" subtitle="Se muestran las 10 más recientes." />
        {runs.data.length === 0 ? (
          <EmptyState
            title="Sin ejecuciones todavía"
            hint='Cargá un proyecto + suite y ejecutá con "Ejecutar pruebas".'
          />
        ) : (
          <ul className="divide-y rounded-lg border bg-white" data-testid="lista-runs">
            {runs.data.map((r) => (
              <li key={r.id} className="grid grid-cols-7 items-center px-4 py-3 text-sm" data-testid={`row-run-${r.id.slice(0, 8)}`}>
                <Link
                  href={`/dashboard/qa-center/runs/${r.id}`}
                  className="col-span-2 font-mono text-xs text-slate-700 hover:underline"
                >
                  {r.id.slice(0, 8)}
                </Link>
                <span><StatusBadge status={r.status} /></span>
                <span className="text-slate-600">{traducirTrigger(r.trigger)}</span>
                <span className="text-slate-600">{r.duration_ms != null ? `${r.duration_ms} ms` : "—"}</span>
                <span className="text-xs text-slate-400">
                  {new Date(r.created_at).toLocaleString("es-PY")}
                </span>
                <span className="text-right">
                  <Link
                    href={`/dashboard/qa-center/runs/${r.id}`}
                    data-testid={`link-ver-${r.id.slice(0, 8)}`}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Ver detalle
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-slate-50 px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    queued:  { cls: "bg-slate-100 text-slate-700",     label: "en cola" },
    running: { cls: "bg-blue-100 text-blue-700",       label: "ejecutando" },
    passed:  { cls: "bg-emerald-100 text-emerald-700", label: "pasó" },
    failed:  { cls: "bg-rose-100 text-rose-700",       label: "falló" },
    aborted: { cls: "bg-amber-100 text-amber-700",     label: "abortado" },
    error:   { cls: "bg-red-100 text-red-700",         label: "error" },
  };
  const entry = map[status] ?? { cls: "bg-slate-100 text-slate-700", label: status };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${entry.cls}`}>{entry.label}</span>;
}

function traducirTrigger(trigger: string): string {
  const map: Record<string, string> = {
    manual: "manual",
    webhook_pr: "por PR (webhook)",
    cron: "programada",
    retry: "reintento",
  };
  return map[trigger] ?? trigger;
}

function MigrationPendingBanner({
  projects, runs,
}: { projects: QaListResult<QaProjectRow>; runs: QaListResult<QaRunRow> }) {
  const notes = [projects.note, runs.note].filter((n): n is string => Boolean(n));
  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">Panel operativo, datos aún no disponibles</p>
      <p className="mt-1 text-xs text-amber-800">
        El panel no simula información. Pasos pendientes antes de que haya datos:
      </p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-amber-800">
        <li>Aplicar <code>20261112000000_qa_center_schema.sql</code>.</li>
        <li>Agregar <code>&quot;qa_center&quot;</code> a <code>schemas</code> y recargar.</li>
        <li>Crear el primer proyecto desde &quot;+ Nuevo proyecto&quot;.</li>
      </ol>
      {notes.length > 0 && <p className="mt-2 text-xs text-amber-700">Detalle: {notes.join(" · ")}</p>}
    </div>
  );
}
