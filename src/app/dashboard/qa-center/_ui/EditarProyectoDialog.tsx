"use client";

import { useState } from "react";
import type { QaProjectRow } from "@/lib/qa/db";
import RepoSelector from "./RepoSelector";

type Props = {
  project: QaProjectRow;
  onClose: () => void;
  onSaved: () => void;
};

export default function EditarProyectoDialog({ project, onClose, onSaved }: Props) {
  const [name, setName] = useState(project.name);
  const [repoUrl, setRepoUrl] = useState<string | null>(project.repo_url);
  const [targetBaseUrl, setTargetBaseUrl] = useState(project.target_base_url);
  const [targetEnv, setTargetEnv] = useState<"staging" | "preview" | "local">(project.target_env);
  const [defaultBranch, setDefaultBranch] = useState(project.default_branch);
  const [tipoProyecto, setTipoProyecto] = useState<"erp" | "web">(project.tipo_proyecto ?? "erp");
  const [mostrarAvanzado, setMostrarAvanzado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/qa/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          repo_url: repoUrl ?? "",
          target_base_url: targetBaseUrl,
          target_env: targetEnv,
          default_branch: defaultBranch,
          tipo_proyecto: tipoProyecto,
        }),
      });
      const text = await res.text();
      let body: { data?: unknown; error?: string; field?: string } = {};
      try { body = text ? (JSON.parse(text) as typeof body) : {}; } catch { /* ignore */ }
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
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">Editar proyecto</h3>
        <p className="mb-3 text-xs font-mono text-slate-500">{project.slug}</p>
        <div className="space-y-3 text-sm">
          <label className="block"><span className="mb-1 block text-slate-600">Repositorio del ERP</span>
            <RepoSelector value={repoUrl} onChange={(url) => setRepoUrl(url)} testid="ed-repo" />
          </label>
          <label className="block"><span className="mb-1 block text-slate-600">Nombre</span>
            <input data-testid="ed-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1" />
          </label>

          <div>
            <p className="mb-1 text-slate-600">Tipo de proyecto</p>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-xs ${tipoProyecto === "erp" ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-white"}`} data-testid="ed-tipo-erp">
                <input type="radio" name="ed_tipo_proyecto" value="erp" checked={tipoProyecto === "erp"} onChange={() => setTipoProyecto("erp")} className="accent-sky-600" />
                <span><strong>ERP</strong> — menú con links</span>
              </label>
              <label className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-xs ${tipoProyecto === "web" ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-white"}`} data-testid="ed-tipo-web">
                <input type="radio" name="ed_tipo_proyecto" value="web" checked={tipoProyecto === "web"} onChange={() => setTipoProyecto("web")} className="accent-sky-600" />
                <span><strong>Web</strong> — tabs/SPA</span>
              </label>
            </div>
          </div>

          <div className="rounded border border-slate-200">
            <button
              type="button"
              data-testid="btn-avanzado-edit"
              onClick={() => setMostrarAvanzado((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <span>Configuración avanzada</span>
              <span className="text-slate-400">{mostrarAvanzado ? "▲" : "▼"}</span>
            </button>
            {mostrarAvanzado && (
              <div className="space-y-3 border-t border-slate-200 px-3 py-3">
                <label className="block"><span className="mb-1 block text-slate-600">URL del ERP (opcional)</span>
                  <input data-testid="ed-url" value={targetBaseUrl} onChange={(e) => setTargetBaseUrl(e.target.value)}
                    placeholder="(opcional)" className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
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
              </div>
            )}
          </div>

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
