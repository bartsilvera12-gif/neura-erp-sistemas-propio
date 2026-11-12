"use client";

/**
 * Botón "Ejecutar QA" + dialog mínimo para seleccionar proyecto + suite.
 * Postea a `/api/qa/runs`. El servidor valida y gatea super_admin.
 *
 * Nota: sin suites listadas (fase 2 de la UI), el dialog pide ingresar
 * manualmente el suite UUID de la base QA. Esto es intencional para no
 * ocultar que la seed de suites todavía no está automatizada.
 */

import { useState } from "react";
import type { QaProjectRow } from "@/lib/qa/db";

type Props = { projects: ReadonlyArray<QaProjectRow>; disabled?: boolean };

export default function EjecutarQaButton({ projects, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? "");
  const [suiteId, setSuiteId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const clientRequestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Math.random());

  const submit = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/qa/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          suite_id: suiteId,
          client_request_id: clientRequestId,
        }),
      });
      const body = (await res.json()) as { run?: { id: string }; error?: string; code?: string };
      if (!res.ok) {
        setMsg(`Error ${res.status}: ${body.error ?? "fallo"} (${body.code ?? "-"})`);
        return;
      }
      setMsg(`Run ${body.run?.id?.slice(0, 8) ?? "?"} encolado.`);
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error de red");
    } finally {
      setBusy(false);
    }
  };

  if (disabled || projects.length === 0) {
    return (
      <button
        disabled
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
        className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
      >
        Ejecutar QA
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
            <h3 className="mb-3 text-lg font-semibold">Encolar nuevo run</h3>
            <label className="mb-3 block text-sm">
              <span className="text-slate-600">Proyecto</span>
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
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
              <span className="text-slate-600">Suite UUID</span>
              <input
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                placeholder="xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx"
                value={suiteId}
                onChange={(e) => setSuiteId(e.target.value)}
              />
            </label>
            {msg && <p className="mb-3 text-xs text-slate-600">{msg}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded border border-slate-300 px-3 py-1 text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={busy || !projectId || suiteId.length < 8}
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
