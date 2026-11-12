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
import EjecutarQaButton from "./EjecutarQaButton";
import NuevoProyectoDialog from "./NuevoProyectoDialog";
import EditarProyectoDialog from "./EditarProyectoDialog";
import SuitesSection from "./SuitesSection";
import FindingsSection from "./FindingsSection";

type Props = {
  projects: QaListResult<QaProjectRow>;
  runs: QaListResult<QaRunRow>;
  findings?: QaFindingRow[];
};

export default function QaCenterPanel({ projects, runs, findings }: Props) {
  const migrationPending =
    projects.migration_status !== "ready" || runs.migration_status !== "ready";

  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? projects.data.find((p) => p.id === editingId) ?? null : null;

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
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.slug} · branch {p.default_branch} · {p.target_env}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
                      {p.target_base_url}
                    </span>
                    <button
                      onClick={() => setEditingId(p.id)}
                      data-testid={`btn-editar-${p.slug}`}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
                    >
                      Editar
                    </button>
                  </div>
                </div>
                <SuitesSection projectId={p.id} projectSlug={p.slug} />
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
            hint='Cargá un proyecto + suite y ejecutá con "Ejecutar QA".'
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
                <span className="text-slate-600">{r.trigger}</span>
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
  const map: Record<string, string> = {
    queued: "bg-slate-100 text-slate-700",
    running: "bg-blue-100 text-blue-700",
    passed: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
    aborted: "bg-amber-100 text-amber-700",
    error: "bg-red-100 text-red-700",
  };
  const cls = map[status] ?? "bg-slate-100 text-slate-700";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
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
