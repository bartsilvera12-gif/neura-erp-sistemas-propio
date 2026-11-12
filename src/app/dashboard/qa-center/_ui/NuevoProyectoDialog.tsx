"use client";

import { useState } from "react";

type Props = {
  onClose: () => void;
  onCreated: (id: string) => void;
};

/** Dialog de creación de proyecto QA. Reutiliza /api/qa/projects. */
export default function NuevoProyectoDialog({ onClose, onCreated }: Props) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [targetBaseUrl, setTargetBaseUrl] = useState("");
  const [targetEnv, setTargetEnv] = useState<"staging" | "preview" | "local">("staging");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/qa/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, name, target_base_url: targetBaseUrl, target_env: targetEnv, default_branch: defaultBranch,
        }),
      });
      const body = (await res.json()) as { data?: { id: string }; error?: string; field?: string };
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" data-testid="dlg-nuevo-proyecto">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h3 className="mb-3 text-lg font-semibold">Nuevo proyecto QA</h3>
        <div className="space-y-3 text-sm">
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
          <Field
            label="Dirección del entorno de pruebas"
            hint="URL completa del ERP a probar. No puede ser el ERP productivo (api.neura.com.py, sistemas.neura.com.py)."
            htmlFor="pr-url"
          >
            <input id="pr-url" data-testid="in-url" className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              placeholder="http://127.0.0.1:3000" value={targetBaseUrl} onChange={(e) => setTargetBaseUrl(e.target.value)} />
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
          {err && <p className="text-xs text-rose-600" data-testid="dlg-err">{err}</p>}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-xs">Cancelar</button>
          <button
            onClick={submit}
            disabled={busy || !slug || !name || !targetBaseUrl}
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
