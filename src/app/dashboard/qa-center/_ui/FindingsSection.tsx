"use client";

import { useEffect, useState } from "react";
import type { QaFindingRow } from "@/lib/qa/repo-types";

type Props = { initial?: QaFindingRow[] };

/**
 * Sección colapsable que lista los hallazgos (findings) registrados en
 * qa_center.findings — típicamente cargados por una auditoría estática.
 *
 * NO es fuente de verdad: cada finding viene con `status` (por defecto `open`
 * = pendiente de validación) y `description` contiene el detalle del hallazgo
 * tal como fue registrado (módulo, archivo, severidad, corrección sugerida).
 */
export default function FindingsSection({ initial }: Props) {
  const [items, setItems] = useState<QaFindingRow[]>(initial ?? []);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const reload = async (): Promise<void> => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/qa/findings?limit=200", { cache: "no-store" });
      const body = (await res.json()) as { data?: QaFindingRow[]; error?: string };
      if (!res.ok) { setErr(body.error ?? `HTTP ${res.status}`); return; }
      setItems(body.data ?? []);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (initial === undefined) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bySeverity = items.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="mb-8" data-testid="sec-findings">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Hallazgos</h2>
          <p className="text-xs text-slate-500">
            Errores detectados por auditorías. Cada uno trae módulo, archivo y severidad.
            Los <code>open</code> están <strong>pendientes de validación</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SeverityPills counts={bySeverity} />
          <button
            onClick={() => void reload()}
            disabled={loading}
            data-testid="btn-findings-refresh"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
          >
            {loading ? "…" : "Refrescar"}
          </button>
        </div>
      </div>
      {err && <p className="mb-2 text-xs text-rose-600">Error: {err}</p>}
      {!loading && items.length === 0 && !err && (
        <div className="rounded-lg border border-dashed bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
          No hay hallazgos registrados.
        </div>
      )}
      {items.length > 0 && (
        <ul className="divide-y rounded-lg border bg-white" data-testid="lista-findings">
          {items.map((f) => {
            const open = Boolean(expanded[f.id]);
            return (
              <li key={f.id} className="px-4 py-3" data-testid={`row-finding-${f.id.slice(0, 8)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{f.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      <SeverityBadge severity={f.severity} />
                      <span className="ml-2">
                        status <StatusBadge status={f.status} />
                      </span>
                      <span className="ml-2 text-slate-400">
                        · creado {new Date(f.created_at).toLocaleString("es-PY")}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => setExpanded((s) => ({ ...s, [f.id]: !open }))}
                    data-testid={`btn-toggle-${f.id.slice(0, 8)}`}
                    className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-100"
                  >
                    {open ? "Ocultar" : "Ver detalle"}
                  </button>
                </div>
                {open && (
                  <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                    {f.description && (
                      <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-700">
                        {f.description}
                      </pre>
                    )}
                    {f.triage_notes && (
                      <p className="mt-2 text-[11px] text-amber-800">
                        <strong>Triage:</strong> {f.triage_notes}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    blocker: "bg-red-100 text-red-800",
    critical: "bg-rose-100 text-rose-800",
    major: "bg-amber-100 text-amber-800",
    minor: "bg-sky-100 text-sky-800",
    info: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${map[severity] ?? "bg-slate-100 text-slate-700"}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-amber-100 text-amber-800",
    triaged: "bg-sky-100 text-sky-800",
    confirmed: "bg-rose-100 text-rose-800",
    wont_fix: "bg-slate-100 text-slate-500",
    fixed: "bg-emerald-100 text-emerald-700",
    closed: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${map[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status}
    </span>
  );
}

function SeverityPills({ counts }: { counts: Record<string, number> }) {
  const order = ["blocker", "critical", "major", "minor", "info"];
  const items = order.filter((s) => counts[s] > 0);
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-1 text-[10px]">
      {items.map((s) => (
        <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
          <SeverityBadge severity={s} /> <strong>{counts[s]}</strong>
        </span>
      ))}
    </div>
  );
}
