"use client";

import { useEffect, useState } from "react";
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
  const [tipoProyecto, setTipoProyecto] = useState<"erp" | "web">("erp");
  const [mostrarAvanzado, setMostrarAvanzado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger entry animation after mount
    const t = setTimeout(() => setMounted(true), 10);
    // Prevent background scroll while modal is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Esc to close
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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
          slug, name,
          repo_url: repoUrl ?? "",
          target_base_url: targetBaseUrl,
          target_env: targetEnv,
          default_branch: defaultBranch,
          tipo_proyecto: tipoProyecto,
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

  const puedeCrear = Boolean(slug && name && (repoUrl || targetBaseUrl));

  // Estado por sección para saber si está "completa" (con efecto visual).
  const seccion1Ok = Boolean(repoUrl);
  const seccion2Ok = Boolean(slug && name);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 transition-opacity duration-200 ${mounted ? "opacity-100" : "opacity-0"} bg-slate-950/50 backdrop-blur-sm`}
      data-testid="dlg-nuevo-proyecto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 transition-all duration-300 ${mounted ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"}`}
      >
        {/* HEADER con gradiente Neura */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#0B3A3D] via-[#104A4E] to-[#285C62] px-6 py-5 text-white">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#7DCFD2]/20 blur-2xl"></div>
          <div className="absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-[#0EA5E9]/20 blur-2xl"></div>
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7DCFD2]">NEURA QA Center</p>
              <h3 className="mt-0.5 text-xl font-semibold">Nuevo proyecto</h3>
              <p className="mt-1 text-xs text-white/80">Conectá un ERP para que el agente IA lo audite automáticamente.</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="shrink-0 rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>

        {/* BODY con scroll interno */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          <div className="space-y-4">
            {/* Sección 1: Repositorio */}
            <section className="group rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 hover:border-[#7DCFD2]/50 hover:shadow-md">
              <div className="mb-3 flex items-start gap-3">
                <StepBadge n={1} ok={seccion1Ok} />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-slate-900">Repositorio del ERP</h4>
                  <p className="mt-0.5 text-xs text-slate-500">El agente IA analiza el código desde ahí.</p>
                </div>
              </div>
              <RepoSelector value={repoUrl} onChange={onRepoChange} testid="pr-repo" />
            </section>

            {/* Sección 2: Identificación */}
            <section className="group rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 hover:border-[#7DCFD2]/50 hover:shadow-md">
              <div className="mb-3 flex items-start gap-3">
                <StepBadge n={2} ok={seccion2Ok} />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-slate-900">Identificación del proyecto</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Nombre interno (slug) y cómo aparecerá en el panel.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FieldInline id="pr-slug" label="Identificador corto" hint="minúsculas, con guiones — ej. erp-pruebas">
                  <input
                    id="pr-slug" data-testid="in-slug"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs transition-colors focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
                    placeholder="erp-pruebas" value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </FieldInline>
                <FieldInline id="pr-name" label="Nombre visible" hint="Lo que verás en la lista.">
                  <input
                    id="pr-name" data-testid="in-name"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm transition-colors focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
                    placeholder="ERP de pruebas" value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FieldInline>
              </div>
            </section>

            {/* Sección "Tipo de proyecto": decide la estrategia de descubrimiento */}
            <section className="group rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 hover:border-[#7DCFD2]/50 hover:shadow-md">
              <div className="mb-3 flex items-start gap-3">
                <StepBadge n={3} ok={true} />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-slate-900">Tipo de proyecto</h4>
                  <p className="mt-0.5 text-xs text-slate-500">Elegí según cómo esté construido el panel.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${tipoProyecto === "erp" ? "border-[#0EA5E9] bg-[#0EA5E9]/5 ring-1 ring-[#0EA5E9]/20" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  data-testid="in-tipo-erp"
                >
                  <input
                    type="radio" name="tipo_proyecto" value="erp"
                    checked={tipoProyecto === "erp"}
                    onChange={() => setTipoProyecto("erp")}
                    className="mt-0.5 accent-[#0EA5E9]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">ERP</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Menú tradicional con links. Mevo, Villa Hayes, Açaí…</p>
                  </div>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all ${tipoProyecto === "web" ? "border-[#0EA5E9] bg-[#0EA5E9]/5 ring-1 ring-[#0EA5E9]/20" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  data-testid="in-tipo-web"
                >
                  <input
                    type="radio" name="tipo_proyecto" value="web"
                    checked={tipoProyecto === "web"}
                    onChange={() => setTipoProyecto("web")}
                    className="mt-0.5 accent-[#0EA5E9]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">Página web</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Panel con tabs/botones (SPA). Rincón Alpino, admin de landings…</p>
                  </div>
                </label>
              </div>
            </section>

            {/* Sección 4: Avanzado (colapsable con animación) */}
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-all duration-200 hover:border-slate-300">
              <button
                type="button"
                data-testid="btn-avanzado"
                onClick={() => setMostrarAvanzado((v) => !v)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Configuración avanzada</p>
                    <p className="text-[11px] text-slate-500">URL publicada, tipo de entorno y rama por defecto.</p>
                  </div>
                </div>
                <svg
                  className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${mostrarAvanzado ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                ><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div
                className={`grid transition-all duration-300 ease-out ${mostrarAvanzado ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
              >
                <div className="overflow-hidden">
                  <div className="space-y-3 border-t border-slate-200 bg-slate-50/50 px-4 py-4">
                    <FieldInline
                      id="pr-url"
                      label="URL del ERP publicado (opcional)"
                      hint="Solo para pruebas funcionales. No puede ser el ERP productivo."
                    >
                      <input
                        id="pr-url" data-testid="in-url"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs transition-colors focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
                        placeholder="http://127.0.0.1:3000"
                        value={targetBaseUrl} onChange={(e) => setTargetBaseUrl(e.target.value)}
                      />
                    </FieldInline>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FieldInline id="pr-env" label="Tipo de entorno" hint="Staging / Vista previa son remotos; Local es tu PC.">
                        <select
                          id="pr-env" data-testid="in-env"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm transition-colors focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
                          value={targetEnv}
                          onChange={(e) => setTargetEnv(e.target.value as typeof targetEnv)}
                        >
                          <option value="staging">Staging (remoto)</option>
                          <option value="preview">Vista previa</option>
                          <option value="local">Local</option>
                        </select>
                      </FieldInline>
                      <FieldInline id="pr-branch" label="Rama de Git" hint="Dejá 'main' si no estás seguro.">
                        <input
                          id="pr-branch" data-testid="in-branch"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs transition-colors focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
                          value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)}
                        />
                      </FieldInline>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {err && (
              <div className="animate-in fade-in rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" data-testid="dlg-err">
                <strong>Error:</strong> {err}
              </div>
            )}
          </div>
        </div>

        {/* FOOTER fijo */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <p className="text-[11px] text-slate-500">
            {puedeCrear ? "Listo para crear" : "Falta repositorio o nombre"}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={busy || !puedeCrear}
              data-testid="btn-crear-proyecto"
              className="rounded-lg bg-[#0EA5E9] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#0284C7] hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Creando…" : "Crear proyecto"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepBadge({ n, ok }: { n: number; ok: boolean }) {
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300 ${
        ok
          ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-200"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {ok ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        n
      )}
    </div>
  );
}

function FieldInline({
  id, label, hint, children,
}: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
