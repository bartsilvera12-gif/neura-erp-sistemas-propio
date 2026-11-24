/**
 * QA Center · Resultados — últimos 10 runs con estado y link al detalle.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { listQaRuns } from "@/lib/qa/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center · Resultados" };

const STATUS_COLOR: Record<string, string> = {
  passed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  failed: "bg-rose-100 text-rose-700 ring-rose-200",
  running: "bg-sky-100 text-sky-700 ring-sky-200",
  queued: "bg-slate-100 text-slate-700 ring-slate-200",
  aborted: "bg-amber-100 text-amber-700 ring-amber-200",
  error: "bg-rose-100 text-rose-700 ring-rose-200",
};

export default async function QaResultadosPage() {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) notFound();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  let runs: Awaited<ReturnType<typeof listQaRuns>>;
  try { runs = await listQaRuns({ limit: 10 }); }
  catch { runs = { data: [], migration_status: "config_missing" }; }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Resultados</h1>
        <p className="mt-1 text-sm text-slate-600">Las últimas 10 ejecuciones con su estado y duración.</p>
      </header>

      {runs.data.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <p className="text-sm text-slate-600">No hay ejecuciones todavía.</p>
          <Link
            href="/dashboard/qa-center/ejecucion"
            className="mt-3 inline-block rounded-lg bg-[#0EA5E9] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0284C7]"
          >
            Ir a Ejecución
          </Link>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="lista-resultados">
          {runs.data.map((r) => {
            const colorClass = STATUS_COLOR[r.status] ?? "bg-slate-100 text-slate-700 ring-slate-200";
            return (
              <li
                key={r.id}
                className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-[#7DCFD2]/60 hover:shadow-md"
              >
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${colorClass}`}>
                  {r.status}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/qa-center/runs/${r.id}`} className="font-mono text-xs text-slate-700 hover:text-[#0EA5E9] hover:underline">
                    {r.id.slice(0, 8)}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {(() => {
                      const t = r.totals ?? {};
                      const p = Number(t.passed ?? 0);
                      const f = Number(t.failed ?? 0);
                      const s = Number(t.skipped ?? 0);
                      const total = p + f + s;
                      return total > 0 ? `${p}/${total} aprobadas · ${f} fallidas · ${s} omitidas` : "sin resultados";
                    })()}
                  </p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-xs font-medium text-slate-700">
                    {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"}
                  </p>
                  <p className="text-[11px] text-slate-400">{new Date(r.created_at).toLocaleString("es-PY")}</p>
                </div>
                <Link href={`/dashboard/qa-center/runs/${r.id}`} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100">
                  Ver detalle
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
