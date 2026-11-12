"use client";

import { useState } from "react";
import type { QaProjectRow } from "@/lib/qa/db";

type Props = {
  project: QaProjectRow;
  onClose: () => void;
  onSaved: () => void;
};

export default function EditarProyectoDialog({ project, onClose, onSaved }: Props) {
  const [name, setName] = useState(project.name);
  const [targetBaseUrl, setTargetBaseUrl] = useState(project.target_base_url);
  const [targetEnv, setTargetEnv] = useState<"staging" | "preview" | "local">(project.target_env);
  const [defaultBranch, setDefaultBranch] = useState(project.default_branch);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/qa/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, target_base_url: targetBaseUrl, target_env: targetEnv, default_branch: defaultBranch,
        }),
      });
      const body = (await res.json()) as { data?: unknown; error?: string; field?: string };
      if (!res.ok || !body.data) {
        setErr(`${body.error ?? "fallo"}${body.field ? ` (${body.field})` : ""}`);
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" data-testid="dlg-editar-proyecto">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">Editar proyecto</h3>
        <p className="mb-3 text-xs font-mono text-slate-500">{project.slug}</p>
        <div className="space-y-3 text-sm">
          <label className="block"><span className="mb-1 block text-slate-600">Nombre</span>
            <input data-testid="ed-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1" />
          </label>
          <label className="block"><span className="mb-1 block text-slate-600">Target base URL</span>
            <input data-testid="ed-url" value={targetBaseUrl} onChange={(e) => setTargetBaseUrl(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
          </label>
          <label className="block"><span className="mb-1 block text-slate-600">Entorno</span>
            <select data-testid="ed-env" value={targetEnv} onChange={(e) => setTargetEnv(e.target.value as typeof targetEnv)} className="w-full rounded border border-slate-300 px-2 py-1">
              <option value="staging">staging</option>
              <option value="preview">preview</option>
              <option value="local">local</option>
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-slate-600">Branch</span>
            <input data-testid="ed-branch" value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1" />
          </label>
          {err && <p className="text-xs text-rose-600" data-testid="dlg-err-edit">{err}</p>}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-xs">Cancelar</button>
          <button onClick={submit} disabled={busy} data-testid="btn-guardar-proyecto"
            className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
