"use client";

import { useEffect, useState } from "react";

type Suite = { id: string; slug: string; name: string; tags: string[]; specs: string[]; enabled: boolean };

type Props = { projectId: string; projectSlug: string; onChange?: () => void };

/** Bloque colapsable: lista de suites + crear nueva. */
export default function SuitesSection({ projectId, projectSlug, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const reload = async (): Promise<void> => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/qa/projects/${projectId}/suites`, { cache: "no-store" });
      const body = (await res.json()) as { data?: Suite[]; error?: string };
      if (!res.ok) { setErr(body.error ?? `HTTP ${res.status}`); return; }
      setSuites(body.data ?? []);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (open && suites.length === 0 && !loading && !err) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 text-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid={`suites-toggle-${projectSlug}`}
        className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
      >
        <span>{open ? "▾" : "▸"} Suites del proyecto</span>
        <span className="text-slate-400">{open && !loading ? `${suites.length} suite(s)` : ""}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 py-3">
          {loading && <p className="text-xs text-slate-500">Cargando suites…</p>}
          {err && <p className="text-xs text-rose-600">Error: {err}</p>}
          {!loading && !err && suites.length === 0 && (
            <p className="mb-2 text-xs text-slate-500">Todavía no hay suites para este proyecto.</p>
          )}
          {suites.length > 0 && (
            <ul className="mb-3 divide-y divide-slate-200 rounded bg-white">
              {suites.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <p className="text-xs font-medium text-slate-800">{s.name}</p>
                    <p className="font-mono text-[10px] text-slate-500">
                      {s.slug} · {s.specs.length} spec(s){s.enabled ? "" : " · DESHABILITADA"}
                    </p>
                  </div>
                  <code className="text-[10px] text-slate-400">{s.specs.slice(0, 2).join(", ")}{s.specs.length > 2 ? "…" : ""}</code>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setShowNew(true)}
            data-testid={`btn-new-suite-${projectSlug}`}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
          >
            + Nueva suite
          </button>
          {showNew && (
            <NewSuiteInline
              projectId={projectId}
              onClose={() => setShowNew(false)}
              onCreated={() => { setShowNew(false); void reload(); onChange?.(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function NewSuiteInline({
  projectId, onClose, onCreated,
}: { projectId: string; onClose: () => void; onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [specsText, setSpecsText] = useState("availability.spec.ts");
  const [tagsText, setTagsText] = useState("smoke");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true); setErr(null);
    const specs = specsText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const tags = tagsText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    try {
      const res = await fetch(`/api/qa/projects/${projectId}/suites`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name, specs, tags, enabled: true }),
      });
      const body = (await res.json()) as { data?: unknown; error?: string; field?: string };
      if (!res.ok || !body.data) {
        setErr(`${body.error ?? "fallo"}${body.field ? ` (${body.field})` : ""}`);
        return;
      }
      onCreated();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error de red"); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-3 space-y-2 rounded border border-slate-200 bg-white p-3 text-xs" data-testid="dlg-new-suite">
      <label className="block"><span className="text-slate-600">Slug</span>
        <input data-testid="sn-slug" value={slug} onChange={(e) => setSlug(e.target.value)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 font-mono" placeholder="availability" />
      </label>
      <label className="block"><span className="text-slate-600">Nombre</span>
        <input data-testid="sn-name" value={name} onChange={(e) => setName(e.target.value)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" placeholder="Smoke · Disponibilidad" />
      </label>
      <label className="block"><span className="text-slate-600">Specs (separados por coma o espacio, sólo *.spec.ts)</span>
        <input data-testid="sn-specs" value={specsText} onChange={(e) => setSpecsText(e.target.value)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 font-mono" />
      </label>
      <label className="block"><span className="text-slate-600">Tags</span>
        <input data-testid="sn-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" />
      </label>
      {err && <p className="text-rose-600" data-testid="sn-err">{err}</p>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onClose} className="rounded border border-slate-300 px-2 py-1 text-xs">Cancelar</button>
        <button onClick={submit} disabled={busy || !slug || !name}
          data-testid="btn-crear-suite"
          className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          {busy ? "Creando…" : "Crear suite"}
        </button>
      </div>
    </div>
  );
}
