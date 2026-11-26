/**
 * NEURA QA CENTER — detalle de ejecución.
 *
 * Autoriza con `resolveQaAccess` (mismo gate que el panel) y lee
 * directamente del repo PG. Fail-closed: 404 si no se autoriza o no existe.
 *
 * El diseño sigue el lenguaje visual Neura (header con gradiente oscuro
 * de la marca, cards blancas sobre slate-50, acentos en #0EA5E9).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import RunTimeline from "./_ui/RunTimeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center · Ejecución" };

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

  const statusTag = STATUS_META[run.status] ?? STATUS_META.queued;

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Header con gradiente Neura */}
      <header className="relative overflow-hidden bg-gradient-to-br from-[#0B3A3D] via-[#104A4E] to-[#285C62] text-white">
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#7DCFD2]/10 blur-3xl" />
        <div className="absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-[#0EA5E9]/10 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 py-6">
          <Link
            href="/dashboard/qa-center/historial"
            className="inline-flex items-center gap-1.5 text-xs text-white/70 transition-colors hover:text-white"
            data-testid="link-volver"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver al historial
          </Link>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Ejecución QA</h1>
                <code className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs text-white/80 ring-1 ring-white/10">
                  #{run.id.slice(0, 8)}
                </code>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusTag.tagClass}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusTag.dotClass}`} />
                  {statusTag.label}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-white/70">
                <span className="font-medium text-white/90">{project?.name ?? "proyecto eliminado"}</span>
                <span className="mx-1.5 text-white/40">·</span>
                {suite?.name ?? "suite libre"}
                <span className="mx-1.5 text-white/40">·</span>
                <TriggerBadge trigger={run.trigger} />
              </p>
            </div>
            {/* Botón descarga del informe PDF. Server-side con pdfkit, no
                requiere JS del cliente: es un <a href> simple que dispara
                la descarga del browser. */}
            <a
              href={`/api/qa/runs/${run.id}/report`}
              download
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/25"
              title="Descargar reporte PDF con el detalle de los hallazgos"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Descargar PDF
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {/* Grid de métricas: 4 arriba (contexto) + 4 abajo (resultados) */}
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="run-stats">
          <StatCard label="Duración" value={formatDuracion(run.duration_ms)} icon="clock" />
          <StatCard
            label="Entorno probado"
            value={urlAmigable(run.target_base_url)}
            icon="globe"
            mono
          />
          <StatCard
            label="Validación de entorno"
            value={
              run.env_assert_passed === null
                ? "no evaluada"
                : run.env_assert_passed
                  ? "entorno confirmado"
                  : "entorno rechazado"
            }
            tone={
              run.env_assert_passed === null
                ? "neutral"
                : run.env_assert_passed
                  ? "ok"
                  : "fail"
            }
            icon="shield"
          />
          <StatCard label="Pasos" value={String(run.totals.passed + run.totals.failed + run.totals.skipped + run.totals.flaky)} icon="list" />

          <StatCard label="Pasaron" value={String(run.totals.passed)} tone="ok" icon="check" />
          <StatCard label="Fallaron" value={String(run.totals.failed)} tone={run.totals.failed > 0 ? "fail" : "neutral"} icon="x" />
          <StatCard label="Omitidas" value={String(run.totals.skipped)} tone="neutral" icon="skip" />
          <StatCard label="Inestables" value={String(run.totals.flaky)} tone={run.totals.flaky > 0 ? "warn" : "neutral"} icon="warn" />
        </section>

        {run.summary && (
          <section className="mb-6 rounded-xl border border-[#7DCFD2]/30 bg-gradient-to-r from-[#7DCFD2]/10 via-white to-white p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0B3A3D] text-white">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0B3A3D]">Resumen del agente</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">{run.summary}</p>
              </div>
            </div>
          </section>
        )}

        <RunTimeline runId={run.id} initialStatus={run.status} />

        {results.length > 0 && <DesgloseModulos results={results} />}

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">Resultado de cada prueba</h2>
            <span className="text-xs text-slate-500">{results.length > 0 ? `${results.length} caso${results.length === 1 ? "" : "s"}` : ""}</span>
          </div>
          {results.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-700">Sin resultados cargados todavía</p>
              <p className="mt-1 text-xs text-slate-500">
                Cuando el agente termine de recorrer el ERP, cada caso aparece acá con su veredicto.
              </p>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="lista-resultados">
              {results.map((r, idx) => {
                const meta = STATUS_META[r.status] ?? STATUS_META.queued;
                return (
                  <li
                    key={`${r.spec_file}:${r.test_title}:${idx}`}
                    className="group rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-[#7DCFD2]/60 hover:shadow-md"
                  >
                    <div className="flex items-start gap-4">
                      <span className={`mt-0.5 inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${meta.tagClass}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                        {meta.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{r.test_title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-500">{r.spec_file}</p>
                        {r.error_message && (
                          <div className="mt-2 overflow-hidden rounded-lg border border-rose-200 bg-rose-50">
                            <div className="flex items-center gap-1.5 border-b border-rose-200 bg-rose-100/60 px-3 py-1.5">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-rose-700">
                                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                              </svg>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-800">
                                {r.error_type ? r.error_type : "Error"}
                              </p>
                            </div>
                            <pre className="max-h-40 overflow-auto px-3 py-2 text-[11px] leading-relaxed text-rose-800 whitespace-pre-wrap">
                              {r.error_message}
                            </pre>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end text-xs text-slate-500">
                        <span className="tabular-nums">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"}</span>
                        {r.retries > 0 && (
                          <span className="mt-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                            {r.retries} reintento{r.retries === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-8 text-center text-[11px] text-slate-400">
          Próximamente: descarga del informe PDF con capturas de pantalla por error.
        </p>
      </main>
    </div>
  );
}

const STATUS_META: Record<string, { label: string; tagClass: string; dotClass: string }> = {
  queued:    { label: "en cola",          tagClass: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",   dotClass: "bg-slate-500" },
  running:   { label: "ejecutando",       tagClass: "bg-sky-100 text-sky-700 ring-1 ring-sky-200",         dotClass: "bg-sky-500 animate-pulse" },
  passed:    { label: "exitosa",          tagClass: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200", dotClass: "bg-emerald-500" },
  failed:    { label: "con fallas",       tagClass: "bg-rose-100 text-rose-700 ring-1 ring-rose-200",       dotClass: "bg-rose-500" },
  aborted:   { label: "abortada",         tagClass: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",   dotClass: "bg-amber-500" },
  error:     { label: "error del runner", tagClass: "bg-red-100 text-red-700 ring-1 ring-red-200",         dotClass: "bg-red-500" },
  skipped:   { label: "omitida",          tagClass: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",   dotClass: "bg-slate-400" },
  flaky:     { label: "inestable",        tagClass: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",   dotClass: "bg-amber-500" },
  timed_out: { label: "tiempo agotado",   tagClass: "bg-rose-100 text-rose-700 ring-1 ring-rose-200",       dotClass: "bg-rose-500" },
};

const TRIGGER_LABEL: Record<string, string> = {
  manual:   "disparo manual",
  sandbox:  "sandbox",
  cron:     "automático",
  api:      "vía API",
};

function TriggerBadge({ trigger }: { trigger: string }) {
  return <span>{TRIGGER_LABEL[trigger] ?? trigger}</span>;
}

function formatDuracion(ms: number | null): string {
  if (ms == null) return "en curso";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m} min ${rs} s`;
}

function urlAmigable(valor: string): string {
  if (!valor) return "—";
  try {
    const u = new URL(valor);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return valor;
  }
}

type ToneKey = "neutral" | "ok" | "fail" | "warn";
type IconKey = "clock" | "globe" | "shield" | "list" | "check" | "x" | "skip" | "warn";

function StatCard({
  label,
  value,
  tone = "neutral",
  icon,
  mono,
}: {
  label: string;
  value: string;
  tone?: ToneKey;
  icon: IconKey;
  mono?: boolean;
}) {
  const toneCls: Record<ToneKey, string> = {
    neutral: "text-slate-900",
    ok:      "text-emerald-700",
    fail:    "text-rose-700",
    warn:    "text-amber-700",
  };
  const iconBg: Record<ToneKey, string> = {
    neutral: "bg-slate-100 text-slate-600",
    ok:      "bg-emerald-100 text-emerald-700",
    fail:    "bg-rose-100 text-rose-700",
    warn:    "bg-amber-100 text-amber-700",
  };
  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-3 transition-all hover:border-[#7DCFD2]/50 hover:shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${iconBg[tone]}`}>
          <StatIcon kind={icon} />
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <p className={`mt-2 break-words text-sm font-semibold ${toneCls[tone]} ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function StatIcon({ kind }: { kind: IconKey }) {
  const paths: Record<IconKey, React.ReactNode> = {
    clock:  (<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>),
    globe:  (<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" /></>),
    shield: (<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>),
    list:   (<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>),
    check:  (<><polyline points="20 6 9 17 4 12" /></>),
    x:      (<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>),
    skip:   (<><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></>),
    warn:   (<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>),
  };
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[kind]}
    </svg>
  );
}

/** Infiere el módulo del nombre del spec. */
function modulodeSpec(spec_file: string): string {
  const base = spec_file.replace(/\.spec\.ts$/i, "");
  const m = base.match(/^erp-neura-(.+)$/);
  if (m) return m[1];
  const m2 = base.match(/^sistemas-propio-(.+)$/);
  if (m2) return m2[1];
  return base;
}

type ResultadoItem = { spec_file: string; status: string };

function DesgloseModulos({ results }: { results: ReadonlyArray<ResultadoItem> }) {
  const porModulo = new Map<string, { passed: number; failed: number; skipped: number; flaky: number; timedout: number; total: number }>();
  for (const r of results) {
    const key = modulodeSpec(r.spec_file);
    const entry = porModulo.get(key) ?? { passed: 0, failed: 0, skipped: 0, flaky: 0, timedout: 0, total: 0 };
    entry.total++;
    if (r.status === "passed") entry.passed++;
    else if (r.status === "failed") entry.failed++;
    else if (r.status === "skipped") entry.skipped++;
    else if (r.status === "flaky") entry.flaky++;
    else if (r.status === "timed_out") entry.timedout++;
    porModulo.set(key, entry);
  }
  const filas = [...porModulo.entries()].sort(([a], [b]) => a.localeCompare(b));
  return (
    <section className="mb-6" data-testid="desglose-modulos">
      <h2 className="mb-3 text-base font-semibold text-slate-900">Cobertura por módulo</h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Módulo</th>
              <th className="px-3 py-2.5 text-right font-semibold text-emerald-700">Pasaron</th>
              <th className="px-3 py-2.5 text-right font-semibold text-rose-700">Fallaron</th>
              <th className="px-3 py-2.5 text-right font-semibold">Omitidas</th>
              <th className="px-3 py-2.5 text-right font-semibold text-amber-700">Inestables</th>
              <th className="px-3 py-2.5 text-right font-semibold text-rose-600">Timeout</th>
              <th className="px-4 py-2.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.map(([modulo, e]) => (
              <tr key={modulo} className="transition-colors hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium capitalize text-slate-800">{modulo.replace(/[-_]/g, " ")}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{e.passed}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-rose-700">{e.failed}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{e.skipped}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{e.flaky}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{e.timedout}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">{e.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ErrorPane({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="font-medium text-rose-900">{title}</p>
        <p className="mt-1 text-sm text-rose-800">{detail}</p>
      </div>
    </div>
  );
}
