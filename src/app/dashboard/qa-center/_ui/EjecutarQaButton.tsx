"use client";

/**
 * Botón "Ejecutar QA" + dialog. Selector de proyecto y suite (dropdown que
 * se puebla via `GET /api/qa/projects/[id]/suites`). Sin UUIDs manuales.
 */

import { useEffect, useState } from "react";
import type { QaProjectRow } from "@/lib/qa/db";

type SuiteOpt = { id: string; name: string; slug: string; enabled: boolean; specs: string[] };
type Props = { projects: ReadonlyArray<QaProjectRow>; disabled?: boolean };

export default function EjecutarQaButton({ projects, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? "");
  const [suites, setSuites] = useState<SuiteOpt[]>([]);
  const [suitesLoading, setSuitesLoading] = useState(false);
  const [suitesError, setSuitesError] = useState<string | null>(null);
  const [suiteId, setSuiteId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "info" | "error" | "success"; text: string } | null>(null);
  const [clientRequestId] = useState<string>(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Math.random())
  );

  // Cargar suites al abrir / cambiar proyecto.
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setSuitesLoading(true);
    setSuitesError(null);
    setSuiteId("");
    (async () => {
      try {
        const res = await fetch(`/api/qa/projects/${projectId}/suites`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setSuitesError(`Error ${res.status} al cargar suites`);
          setSuites([]);
          return;
        }
        const body = (await res.json()) as { data?: SuiteOpt[] };
        const data = (body.data ?? []).filter((s) => s.enabled);
        setSuites(data);
        if (data.length > 0) setSuiteId(data[0].id);
      } catch (e) {
        if (!cancelled) {
          setSuitesError(e instanceof Error ? e.message : "Error de red");
          setSuites([]);
        }
      } finally {
        if (!cancelled) setSuitesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, projectId]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/qa/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, suite_id: suiteId, client_request_id: clientRequestId }),
      });
      const body = (await res.json()) as { run?: { id: string }; error?: string; code?: string };
      if (!res.ok) {
        setMsg({ kind: "error", text: `Error ${res.status}: ${body.error ?? "fallo"}` });
        return;
      }
      setMsg({ kind: "success", text: `Run ${body.run?.id?.slice(0, 8) ?? "?"} encolado.` });
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Error de red" });
    } finally {
      setBusy(false);
    }
  };

  if (disabled || projects.length === 0) {
    return (
      <button
        disabled
        data-testid="btn-ejecutar-qa"
        className="rounded bg-slate-200 px-3 py-1 text-xs text-slate-500"
        title="Cargá al menos un proyecto para habilitar"
      >
        Ejecutar QA
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-testid="btn-ejecutar-qa"
        className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
      >
        Ejecutar QA
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" data-testid="dlg-ejecutar">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
            <h3 className="mb-3 text-lg font-semibold">Encolar nuevo run</h3>

            <label className="mb-3 block text-sm">
              <span className="text-slate-600">Proyecto</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                data-testid="sel-proyecto"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.slug})
                  </option>
                ))}
              </select>
            </label>

            <label className="mb-3 block text-sm">
              <span className="text-slate-600">Suite</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                data-testid="sel-suite"
                value={suiteId}
                onChange={(e) => setSuiteId(e.target.value)}
                disabled={suitesLoading || suites.length === 0}
              >
                {suitesLoading && <option value="">Cargando…</option>}
                {!suitesLoading && suites.length === 0 && <option value="">Sin suites habilitadas</option>}
                {suites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.slug}) · {s.specs.length} spec{s.specs.length === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              {suitesError && <p className="mt-1 text-xs text-rose-600">{suitesError}</p>}
            </label>

            {msg && (
              <p
                className={
                  msg.kind === "error"
                    ? "mb-3 text-xs text-rose-600"
                    : msg.kind === "success"
                    ? "mb-3 text-xs text-emerald-700"
                    : "mb-3 text-xs text-slate-600"
                }
                data-testid="dlg-msg"
              >
                {msg.text}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded border border-slate-300 px-3 py-1 text-xs"
                data-testid="btn-cancelar"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={busy || !projectId || !suiteId}
                data-testid="btn-encolar"
                className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {busy ? "Encolando…" : "Encolar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
