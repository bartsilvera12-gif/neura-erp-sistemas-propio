/**
 * NEURA QA CENTER — detalle de ejecución.
 *
 * Autoriza con `resolveQaAccess` (mismo gate que el panel) y lee
 * directamente del repo PG (sin REST). Fail-closed: 404 si no se autoriza
 * o el run no existe.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { buildQaRepo } from "@/lib/qa/route-helpers";

export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center — Run" };

type Params = { id: string };

export default async function QaRunDetailPage({ params }: { params: Promise<Params> }) {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) notFound();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  const { id } = await params;
  const repo = buildQaRepo();
  if (!repo) return <ErrorPane title="Configuración ausente" detail="QA_DB_URL no configurada." />;

  const run = await repo.getRun(id);
  if (!run) notFound();
  const results = await repo.listResultsForRun(id);
  const project = await repo.getProject(run.project_id);
  const suite = await repo.getSuite(run.suite_id);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-4 text-xs">
        <Link href="/dashboard/qa-center" className="text-slate-600 hover:underline" data-testid="link-volver">
          ← Volver al panel
        </Link>
      </div>

      <header className="mb-5">
        <h1 className="text-xl font-semibold">
          Ejecución <span className="font-mono text-slate-500">{run.id.slice(0, 8)}</span>
        </h1>
        <p className="text-sm text-slate-500">
          {project?.name ?? "proyecto eliminado"} · {suite?.name ?? "suite eliminada"} · {run.trigger}
        </p>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="run-stats">
        <Stat label="Estado"><StatusBadge status={run.status} /></Stat>
        <Stat label="Duración">{run.duration_ms != null ? `${run.duration_ms} ms` : "—"}</Stat>
        <Stat label="Entorno probado">{run.target_base_url}</Stat>
        <Stat label="Verificación de entorno">
          {run.env_assert_passed === null ? "—" : run.env_assert_passed ? "✓ válida" : "✗ falló"}
        </Stat>
        <Stat label="Pasaron">{run.totals.passed}</Stat>
        <Stat label="Fallaron">{run.totals.failed}</Stat>
        <Stat label="Omitidas">{run.totals.skipped}</Stat>
        <Stat label="Inestables">{run.totals.flaky}</Stat>
      </section>

      {run.summary && (
        <p className="mb-6 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          {run.summary}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold">Resultados</h2>
        {results.length === 0 ? (
          <div className="rounded border border-dashed bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
            Todavía no hay resultados reportados.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-white" data-testid="lista-resultados">
            {results.map((r, idx) => (
              <li key={`${r.spec_file}:${r.test_title}:${idx}`} className="px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{r.test_title}</p>
                    <p className="font-mono text-[10px] text-slate-500">{r.spec_file}</p>
                    {r.error_message && (
                      <pre className="mt-2 max-h-40 overflow-auto rounded bg-rose-50 p-2 text-[11px] text-rose-700 whitespace-pre-wrap">
                        {r.error_type ? `[${r.error_type}] ` : ""}{r.error_message}
                      </pre>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end text-xs text-slate-500">
                    <StatusBadge status={r.status} />
                    <span className="mt-1">{r.duration_ms != null ? `${r.duration_ms} ms` : "—"}</span>
                    {r.retries > 0 && <span className="text-amber-600">retries {r.retries}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800 break-all">{children}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    queued:    { cls: "bg-slate-100 text-slate-700",     label: "en cola" },
    running:   { cls: "bg-blue-100 text-blue-700",       label: "ejecutando" },
    passed:    { cls: "bg-emerald-100 text-emerald-700", label: "pasó" },
    failed:    { cls: "bg-rose-100 text-rose-700",       label: "falló" },
    aborted:   { cls: "bg-amber-100 text-amber-700",     label: "abortado" },
    error:     { cls: "bg-red-100 text-red-700",         label: "error" },
    skipped:   { cls: "bg-slate-100 text-slate-500",     label: "omitida" },
    flaky:     { cls: "bg-amber-100 text-amber-800",     label: "inestable" },
    timed_out: { cls: "bg-rose-100 text-rose-700",       label: "tiempo excedido" },
  };
  const entry = map[status] ?? { cls: "bg-slate-100 text-slate-700", label: status };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${entry.cls}`}>{entry.label}</span>;
}

function ErrorPane({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="font-medium text-rose-900">{title}</p>
        <p className="mt-1 text-sm text-rose-800">{detail}</p>
      </div>
    </div>
  );
}
