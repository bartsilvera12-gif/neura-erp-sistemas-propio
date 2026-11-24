/**
 * QA Center · Historial — tabla completa agrupada por día.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { listQaRuns } from "@/lib/qa/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center · Historial" };

const STATUS_COLOR: Record<string, string> = {
  passed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  failed: "bg-rose-100 text-rose-700 ring-rose-200",
  running: "bg-sky-100 text-sky-700 ring-sky-200",
  queued: "bg-slate-100 text-slate-700 ring-slate-200",
  aborted: "bg-amber-100 text-amber-700 ring-amber-200",
  error: "bg-rose-100 text-rose-700 ring-rose-200",
};

function diaDe(iso: string): string {
  return new Date(iso).toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default async function QaHistorialPage() {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) notFound();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  let runs: Awaited<ReturnType<typeof listQaRuns>>;
  try { runs = await listQaRuns({ limit: 100 }); }
  catch { runs = { data: [], migration_status: "config_missing" }; }

  const grupos: Array<{ dia: string; runs: typeof runs.data }> = [];
  for (const r of runs.data) {
    const key = diaDe(r.created_at);
    const g = grupos.find((x) => x.dia === key);
    if (g) g.runs.push(r);
    else grupos.push({ dia: key, runs: [r] });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Historial</h1>
        <p className="mt-1 text-sm text-slate-600">
          {runs.data.length === 0
            ? "Sin ejecuciones registradas todavía."
            : `${runs.data.length} ejecucion(es) agrupadas por día (más recientes primero).`}
        </p>
      </header>

      {runs.data.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <p className="text-sm text-slate-600">Todavía no corrió nada.</p>
          <Link href="/dashboard/qa-center/ejecucion" className="mt-3 inline-block rounded-lg bg-[#0EA5E9] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0284C7]">
            Ir a Ejecución
          </Link>
        </div>
      ) : (
        <div className="space-y-6" data-testid="historial-grupos">
          {grupos.map((g) => (
            <section key={g.dia}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.dia}</h2>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Run</th>
                      <th className="px-4 py-2 text-left font-semibold">Estado</th>
                      <th className="hidden px-4 py-2 text-left font-semibold md:table-cell">Resumen</th>
                      <th className="px-4 py-2 text-right font-semibold">Duración</th>
                      <th className="px-4 py-2 text-right font-semibold">Hora</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.runs.map((r) => {
                      const color = STATUS_COLOR[r.status] ?? "bg-slate-100 text-slate-700 ring-slate-200";
                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-mono text-xs text-slate-700">{r.id.slice(0, 8)}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${color}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="hidden max-w-sm truncate px-4 py-2 text-xs text-slate-600 md:table-cell">
                            {(() => {
                              const t = r.totals ?? {};
                              const p = Number(t.passed ?? 0);
                              const f = Number(t.failed ?? 0);
                              const s = Number(t.skipped ?? 0);
                              const total = p + f + s;
                              return total > 0 ? `${p}/${total} ok · ${f} fail · ${s} skip` : "—";
                            })()}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-slate-600">
                            {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-slate-400">
                            {new Date(r.created_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Link href={`/dashboard/qa-center/runs/${r.id}`} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100">
                              Ver
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
