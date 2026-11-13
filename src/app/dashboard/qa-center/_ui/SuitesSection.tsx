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
        <span>{open ? "▾" : "▸"} Suites de pruebas</span>
        <span className="text-slate-400">{open && !loading ? `${suites.length} suite(s)` : ""}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 py-3">
          {loading && <p className="text-xs text-slate-500">Cargando suites…</p>}
          {err && <p className="text-xs text-rose-600">Error: {err}</p>}
          {!loading && !err && suites.length === 0 && (
            <p className="mb-2 text-xs text-slate-500">Todavía no hay suites de pruebas en este proyecto.</p>
          )}
          {suites.length > 0 && (
            <ul className="mb-3 divide-y divide-slate-200 rounded bg-white">
              {suites.map((s) => (
                <li key={s.id} className="flex items-start justify-between px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800">{s.name}</p>
                    <p className="font-mono text-[10px] text-slate-500">
                      {s.slug} · {s.specs.length} prueba{s.specs.length === 1 ? "" : "s"}
                      {s.enabled ? "" : " · DESHABILITADA"}
                    </p>
                    {s.tags.length > 0 && (
                      <p className="mt-0.5 text-[10px] text-slate-400">etiquetas: {s.tags.join(", ")}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setShowNew(true)}
            data-testid={`btn-new-suite-${projectSlug}`}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100"
          >
            + Nueva suite de pruebas
          </button>
          {showNew && (
            <NuevaSuiteInline
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

// ─────────────────────────────────────────────────────────────────────────
// Nueva suite: selector por checkboxes de pruebas disponibles (en español).
// ─────────────────────────────────────────────────────────────────────────

type PruebaUi = {
  spec_file: string;
  nombre: string;
  descripcion: string;
  tipo: "disponibilidad" | "inicio_sesion" | "navegacion" | "seguridad";
  tests: number;
  requiere_credenciales: boolean;
};
type GrupoUi = { tipo: PruebaUi["tipo"]; etiqueta: string; descripcion: string; pruebas: PruebaUi[] };

function NuevaSuiteInline({
  projectId, onClose, onCreated,
}: { projectId: string; onClose: () => void; onCreated: () => void }) {
  const [nombre, setNombre] = useState("");
  const [grupos, setGrupos] = useState<GrupoUi[]>([]);
  const [cargandoCat, setCargandoCat] = useState(true);
  const [errorCat, setErrorCat] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setCargandoCat(true); setErrorCat(null);
      try {
        const res = await fetch(`/api/qa/pruebas-disponibles?project=${projectId}`, { cache: "no-store" });
        const body = (await res.json()) as { data?: { grupos: GrupoUi[]; total: number }; error?: string };
        if (cancel) return;
        if (!res.ok) { setErrorCat(body.error ?? `HTTP ${res.status}`); setGrupos([]); return; }
        setGrupos(body.data?.grupos ?? []);
      } catch (e) {
        if (!cancel) { setErrorCat(e instanceof Error ? e.message : "Error de red"); setGrupos([]); }
      } finally {
        if (!cancel) setCargandoCat(false);
      }
    })();
    return () => { cancel = true; };
  }, [projectId]);

  const toggle = (spec: string) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(spec)) next.delete(spec); else next.add(spec);
      return next;
    });
  };

  const tiposSeleccionados = Array.from(
    new Set(grupos.flatMap((g) => g.pruebas.filter((p) => seleccion.has(p.spec_file)).map(() => g.tipo)))
  );

  const submit = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try {
      const specs = Array.from(seleccion);
      const res = await fetch(`/api/qa/projects/${projectId}/suites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // El backend recalcula el slug a partir del catálogo; acá lo generamos
          // sólo como hint. Si ya existía, el backend devuelve 409 y lo reintentamos.
          slug: derivarSlugCliente(tiposSeleccionados, new Date()),
          name: nombre.trim(),
          specs,
          tags: tiposSeleccionados,
          enabled: true,
        }),
      });
      const body = (await res.json()) as { data?: unknown; error?: string };
      if (!res.ok || !body.data) {
        setErr(body.error ?? `HTTP ${res.status}`);
        return;
      }
      onCreated();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error de red"); }
    finally { setBusy(false); }
  };

  const total = grupos.reduce((n, g) => n + g.pruebas.length, 0);
  const sinPruebas = !cargandoCat && !errorCat && total === 0;

  return (
    <div className="mt-3 space-y-3 rounded border border-slate-200 bg-white p-3 text-xs" data-testid="dlg-nueva-suite">
      <label className="block">
        <span className="text-slate-600">Nombre visible de la suite</span>
        <input
          data-testid="sn-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Pruebas de humo"
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1"
        />
        <p className="mt-0.5 text-[10px] text-slate-400">
          El identificador técnico (slug) se genera automáticamente.
        </p>
      </label>

      <div>
        <p className="mb-1 text-slate-600">Pruebas disponibles para este proyecto</p>
        {cargandoCat && <p className="text-slate-500">Cargando catálogo…</p>}
        {errorCat && <p className="text-rose-600">Error cargando catálogo: {errorCat}</p>}
        {sinPruebas && (
          <div className="rounded border border-dashed bg-slate-50 px-3 py-4 text-center text-slate-500">
            No hay pruebas disponibles para este proyecto todavía.
          </div>
        )}
        <div className="space-y-3">
          {grupos.map((g) => (
            <fieldset key={g.tipo} className="rounded border border-slate-200 p-2">
              <legend className="px-1 text-[11px] font-semibold text-slate-700">
                {g.etiqueta} <span className="text-slate-400">({g.pruebas.length})</span>
              </legend>
              <p className="mb-2 text-[10px] text-slate-500">{g.descripcion}</p>
              <ul className="space-y-1">
                {g.pruebas.map((p) => (
                  <li key={p.spec_file} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id={`chk-${p.spec_file}`}
                      data-testid={`chk-${p.spec_file}`}
                      checked={seleccion.has(p.spec_file)}
                      onChange={() => toggle(p.spec_file)}
                      className="mt-0.5"
                    />
                    <label htmlFor={`chk-${p.spec_file}`} className="flex-1 cursor-pointer">
                      <span className="block font-medium text-slate-800">{p.nombre}</span>
                      <span className="block text-[10px] text-slate-500">{p.descripcion}</span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        {p.tests} test{p.tests === 1 ? "" : "s"}
                        {p.requiere_credenciales ? " · requiere credenciales de prueba" : ""}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </div>
      </div>

      {err && <p className="text-rose-600" data-testid="sn-err">{err}</p>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onClose} className="rounded border border-slate-300 px-2 py-1 text-xs">Cancelar</button>
        <button
          onClick={submit}
          disabled={busy || nombre.trim().length < 2 || seleccion.size === 0}
          data-testid="btn-crear-suite"
          className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          title={seleccion.size === 0 ? "Marcá al menos una prueba" : ""}
        >
          {busy ? "Creando…" : `Crear suite (${seleccion.size} seleccionada${seleccion.size === 1 ? "" : "s"})`}
        </button>
      </div>
    </div>
  );
}

/** Deriva un slug simple en cliente (el server valida unicidad). */
function derivarSlugCliente(tipos: string[], ahora: Date): string {
  const base = (tipos.length ? [...new Set(tipos)] : ["suite"]).sort().join("-");
  const ts = ahora.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `${base}-${ts}`.toLowerCase();
}
