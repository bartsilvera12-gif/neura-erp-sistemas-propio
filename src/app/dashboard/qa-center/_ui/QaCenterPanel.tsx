"use client";

/**
 * NEURA QA CENTER — vista principal del panel.
 *
 * Componente puro (no fetch adicional): recibe `projects` y `runs` del server
 * component. No simula datos: si vienen vacíos, se muestra el estado vacío
 * con el motivo real (migración pendiente, esquema no expuesto, etc).
 */

import type {
  QaListResult,
  QaProjectRow,
  QaRunRow,
} from "@/lib/qa/db";

type Props = {
  projects: QaListResult<QaProjectRow>;
  runs: QaListResult<QaRunRow>;
};

export default function QaCenterPanel({ projects, runs }: Props) {
  const migrationPending =
    projects.migration_status !== "ready" || runs.migration_status !== "ready";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">QA Center</h1>
        <p className="text-sm text-slate-500">
          Panel de QA Desarrollo. Nunca ejecuta contra producción.
        </p>
      </header>

      {migrationPending && (
        <MigrationPendingBanner projects={projects} runs={runs} />
      )}

      <section className="mb-8">
        <SectionHeader
          title="Proyectos"
          subtitle="Cada proyecto representa un ERP bajo QA."
        />
        {projects.data.length === 0 ? (
          <EmptyState
            title="Todavía no hay proyectos cargados"
            hint={
              migrationPending
                ? "Primero aplicá la migración qa_center y exponé el esquema en PostgREST."
                : "Creá el primer proyecto con la API de administración (fase próxima)."
            }
          />
        ) : (
          <ul className="divide-y rounded-lg border bg-white">
            {projects.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.slug} · branch {p.default_branch} · {p.target_env}
                  </p>
                </div>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {p.target_base_url}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader
          title="Últimas ejecuciones"
          subtitle="Se muestran las 10 más recientes."
        />
        {runs.data.length === 0 ? (
          <EmptyState
            title="Sin ejecuciones todavía"
            hint={
              migrationPending
                ? "La tabla qa_center.runs todavía no está disponible."
                : "Cuando el runner reporte su primera corrida, aparecerá acá."
            }
          />
        ) : (
          <ul className="divide-y rounded-lg border bg-white">
            {runs.data.map((r) => (
              <li key={r.id} className="grid grid-cols-6 items-center px-4 py-3 text-sm">
                <span className="col-span-2 font-mono text-xs text-slate-500">
                  {r.id.slice(0, 8)}
                </span>
                <span>
                  <StatusBadge status={r.status} />
                </span>
                <span className="text-slate-600">{r.trigger}</span>
                <span className="text-slate-600">
                  {r.duration_ms != null ? `${r.duration_ms} ms` : "—"}
                </span>
                <span className="text-right text-xs text-slate-400">
                  {new Date(r.created_at).toLocaleString("es-PY")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function MigrationPendingBanner({
  projects,
  runs,
}: {
  projects: QaListResult<QaProjectRow>;
  runs: QaListResult<QaRunRow>;
}) {
  const notes = [projects.note, runs.note].filter((n): n is string => Boolean(n));
  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">
        Panel operativo, datos aún no disponibles
      </p>
      <p className="mt-1 text-xs text-amber-800">
        El panel no simula información. Pasos pendientes antes de que haya datos:
      </p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-amber-800">
        <li>Aplicar <code>20261112000000_qa_center_schema.sql</code> en Supabase (con backup previo).</li>
        <li>Agregar <code>&quot;qa_center&quot;</code> al array <code>schemas</code> de <code>supabase/config.toml</code> y recargar PostgREST.</li>
        <li>Sembrar al menos un proyecto desde la próxima fase de la API.</li>
      </ol>
      {notes.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">Detalle: {notes.join(" · ")}</p>
      )}
    </div>
  );
}
