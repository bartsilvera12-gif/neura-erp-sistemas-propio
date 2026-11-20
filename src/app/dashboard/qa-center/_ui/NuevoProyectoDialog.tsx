"use client";

import { useState } from "react";
import RepoSelector, { type RepoOption } from "./RepoSelector";

type Props = {
  onClose: () => void;
  onCreated: (id: string) => void;
};

/** Dialog de creación de proyecto QA. Reutiliza /api/qa/projects. */
export default function NuevoProyectoDialog({ onClose, onCreated }: Props) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [targetBaseUrl, setTargetBaseUrl] = useState("");
  const [targetEnv, setTargetEnv] = useState<"staging" | "preview" | "local">("staging");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [mostrarAvanzado, setMostrarAvanzado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onRepoChange = (url: string | null, meta: RepoOption | null): void => {
    setRepoUrl(url);
    if (meta) {
      if (!slug && meta.slug_sugerido) setSlug(meta.slug_sugerido);
      if (!name) setName(meta.etiqueta);
      if (meta.default_branch) setDefaultBranch(meta.default_branch);
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/qa/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          repo_url: repoUrl ?? "",
          target_base_url: targetBaseUrl,
          target_env: targetEnv,
          default_branch: defaultBranch,
        }),
      });
      const text = await res.text();
      let body: { data?: { id: string }; error?: string; field?: string } = {};
      try { body = text ? (JSON.parse(text) as typeof body) : {}; } catch { /* ignore */ }
      if (!res.ok || !body.data) {
        setErr(`${body.error ?? "fallo"}${body.field ? ` (${body.field})` : ""}`);
        return;
      }
      onCreated(body.data.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  };

  // Habilitar crear si: slug + name + (repo o URL).
  const puedeCrear = Boolean(slug && name && (repoUrl || targetBaseUrl));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" data-testid="dlg-nuevo-proyecto">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <h3 className="mb-3 text-lg font-semibold">Nuevo proyecto QA</h3>
        <div className="space-y-3 text-sm">
          <Field
            label="Repositorio del ERP"
            hint="Elegí uno de los repositorios autorizados. El agente IA analiza el código desde ahí."
            htmlFor="pr-repo"
          >
            <RepoSelector value={repoUrl} onChange={onRepoChange} testid="pr-repo" />
          </Field>

          <Field
            label="Identificador corto"
            hint="Nombre interno sin espacios, en minúsculas y con guiones. Ej: erp-pruebas"
            htmlFor="pr-slug"
          >
            <input id="pr-slug" data-testid="in-slug" className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              placeholder="erp-pruebas" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </Field>
          <Field
            label="Nombre visible"
            hint="Cómo lo verás en la lista del panel."
            htmlFor="pr-name"
          >
            <input id="pr-name" data-testid="in-name" className="w-full rounded border border-slate-300 px-2 py-1"
              placeholder="ERP de pruebas" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="rounded border border-slate-200">
            <button
              type="button"
              data-testid="btn-avanzado"
              onClick={() => setMostrarAvanzado((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <span>Configuración avanzada</span>
              <span className="text-slate-400">{mostrarAvanzado ? "▲" : "▼"}</span>
            </button>
            {mostrarAvanzado && (
              <div className="space-y-3 border-t border-slate-200 px-3 py-3">
                <Field
                  label="URL del ERP publicado (opcional)"
                  hint="Sólo necesaria para pruebas funcionales autorizadas. Para análisis de repositorio puede dejarse vacía. No puede ser el ERP productivo."
                  htmlFor="pr-url"
                >
                  <input id="pr-url" data-testid="in-url" className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                    placeholder="(opcional) http://127.0.0.1:3000" value={targetBaseUrl} onChange={(e) => setTargetBaseUrl(e.target.value)} />
                </Field>
                <Field
                  label="Tipo de entorno"
                  hint="Staging y Vista previa son servidores separados del productivo. Local es tu PC."
                  htmlFor="pr-env"
                >
                  <select id="pr-env" data-testid="in-env" className="w-full rounded border border-slate-300 px-2 py-1"
                    value={targetEnv} onChange={(e) => setTargetEnv(e.target.value as typeof targetEnv)}>
                    <option value="staging">Staging (entorno de pruebas remoto)</option>
                    <option value="preview">Vista previa (deploy temporal de una rama)</option>
                    <option value="local">Local (en tu computadora)</option>
                  </select>
                </Field>
                <Field
                  label="Rama de Git por defecto"
                  hint="La rama contra la que normalmente corren las pruebas. Dejá 'main' si no estás seguro."
                  htmlFor="pr-branch"
                >
                  <input id="pr-branch" data-testid="in-branch" className="w-full rounded border border-slate-300 px-2 py-1"
                    value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
                </Field>
              </div>
            )}
          </div>

          {err && <p className="text-xs text-rose-600" data-testid="dlg-err">{err}</p>}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-xs">Cancelar</button>
          <button
            onClick={submit}
            disabled={busy || !puedeCrear}
            data-testid="btn-crear-proyecto"
            className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? "Creando…" : "Crear proyecto"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, htmlFor, hint, children,
}: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </label>
  );
}
