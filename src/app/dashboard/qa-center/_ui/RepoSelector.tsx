"use client";

/**
 * Selector de repositorio GitHub autorizado (dinámico).
 *
 * Consulta `GET /api/qa/admin/repos?q=&page=&per_page=` para traer repos de
 * la cuenta GitHub conectada al QA Center. Soporta:
 *  - buscador server-side con debounce
 *  - paginación con botón "Cargar más"
 *  - mensajes claros si GitHub no está conectado (503) o falla (502)
 *
 * No maneja token GitHub: sólo se comunica con el endpoint interno.
 */

import { useEffect, useMemo, useRef, useState } from "react";

export type RepoOption = {
  url: string;
  owner: string;
  name: string;
  etiqueta: string;
  codebase: string;
  slug_sugerido: string | null;
  default_branch: string;
  private?: boolean;
  updated_at?: string;
};

type Props = {
  value: string | null;
  onChange: (url: string | null, meta: RepoOption | null) => void;
  disabled?: boolean;
  testid?: string;
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; code?: string; message: string }
  | { kind: "ok"; repos: RepoOption[]; has_more: boolean; total: number | null; allowed_owners: string[] };

const PER_PAGE = 50;
const DEBOUNCE_MS = 300;

export default function RepoSelector({ value, onChange, disabled, testid }: Props) {
  const [busq, setBusq] = useState("");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const debouncedRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cargar = (q: string, pageN: number, append: boolean): void => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!append) setState({ kind: "loading" });
    (async () => {
      try {
        const url = new URL("/api/qa/admin/repos", window.location.origin);
        if (q) url.searchParams.set("q", q);
        url.searchParams.set("page", String(pageN));
        url.searchParams.set("per_page", String(PER_PAGE));
        const res = await fetch(url.pathname + url.search, { cache: "no-store", signal: ctrl.signal });
        const text = await res.text();
        let body: {
          data?: RepoOption[];
          pagination?: { has_more: boolean; total: number | null };
          allowed_owners?: string[];
          error?: string;
          code?: string;
        } = {};
        try { body = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
        if (!res.ok) {
          const msg =
            body.code === "no_token"
              ? "GitHub no está conectado al QA Center (contactá al admin)"
              : body.code === "no_allowed_owners"
              ? "No hay owners GitHub autorizados"
              : body.error ?? `HTTP ${res.status}`;
          setState({ kind: "error", code: body.code, message: msg });
          return;
        }
        const nuevos = body.data ?? [];
        setState((prev) => {
          const prevRepos = append && prev.kind === "ok" ? prev.repos : [];
          return {
            kind: "ok",
            repos: [...prevRepos, ...nuevos],
            has_more: body.pagination?.has_more ?? false,
            total: body.pagination?.total ?? null,
            allowed_owners: body.allowed_owners ?? [],
          };
        });
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setState({ kind: "error", message: e instanceof Error ? e.message : "Error de red" });
      }
    })();
  };

  // Debounce al escribir en el buscador.
  useEffect(() => {
    if (debouncedRef.current) clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => {
      setPage(1);
      cargar(busq, 1, false);
    }, DEBOUNCE_MS);
    return () => {
      if (debouncedRef.current) clearTimeout(debouncedRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busq]);

  const seleccion = useMemo<RepoOption | null>(() => {
    if (!value || state.kind !== "ok") return null;
    return state.repos.find((r) => r.url === value) ?? null;
  }, [state, value]);

  // MODO SELECCIONADO: cuando ya hay un repo elegido, mostramos solo una
  // card compacta con los datos + botón "Cambiar" para volver al buscador.
  // Esto ahorra espacio vertical y aclara el estado.
  if (value) {
    const meta = seleccion;
    return (
      <div data-testid={testid ?? "repo-selector"}>
        <div className="group flex items-center gap-3 rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-3 transition-colors">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs font-semibold text-slate-900" data-testid="repo-seleccionado">
              {meta ? `${meta.owner}/${meta.name}` : value}
              {meta?.private ? " 🔒" : ""}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-600">
              {meta ? (
                <>
                  rama <span className="font-mono">{meta.default_branch}</span>
                  {" · "}codebase <span className="font-mono">{meta.codebase}</span>
                </>
              ) : (
                <span className="font-mono text-slate-500">{value}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            data-testid="repo-cambiar"
            onClick={() => onChange(null, null)}
            disabled={disabled}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            Cambiar
          </button>
        </div>
      </div>
    );
  }

  // MODO BÚSQUEDA: sin selección, mostramos input + lista para elegir.
  return (
    <div data-testid={testid ?? "repo-selector"} className="space-y-2">
      <div className="relative">
        <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input
          data-testid="repo-busq"
          placeholder="Buscar repositorio por nombre, owner o URL…"
          value={busq}
          onChange={(e) => setBusq(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-300 bg-white px-8 py-2 text-xs transition-colors focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/20"
        />
      </div>

      {state.kind === "loading" && (
        <p className="text-xs text-slate-500" data-testid="repo-loading">Consultando GitHub…</p>
      )}

      {state.kind === "error" && (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700" data-testid="repo-error">
          <p className="font-medium">No se pudo consultar GitHub</p>
          <p className="mt-0.5">{state.message}</p>
          {state.code === "no_token" && (
            <p className="mt-1 text-[11px] text-rose-600">
              Pedí a Operaciones que configure <code className="font-mono">GITHUB_TOKEN</code> en QA Center.
            </p>
          )}
        </div>
      )}

      {state.kind === "ok" && state.repos.length === 0 && (
        <p className="text-xs text-slate-500" data-testid="repo-vacio">
          Sin resultados para &quot;{busq}&quot;. Owners autorizados: {state.allowed_owners.join(", ") || "(ninguno)"}
        </p>
      )}

      {state.kind === "ok" && state.repos.length > 0 && (
        <>
          <ul
            data-testid="repo-select"
            className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white"
            role="listbox"
          >
            {state.repos.map((r) => (
              <li key={r.url}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onChange(r.url, r)}
                  disabled={disabled}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[#0EA5E9]/10 focus:bg-[#0EA5E9]/10 focus:outline-none"
                >
                  <span className="font-mono font-medium text-slate-800">{r.owner}/{r.name}</span>
                  {r.private && <span title="Privado" className="text-amber-600">🔒</span>}
                  <span className="ml-auto text-[10px] text-slate-400">rama {r.default_branch}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span data-testid="repo-count">
              Mostrando {state.repos.length}
              {state.total !== null ? ` de ${state.total}` : ""}
              {state.allowed_owners.length > 0 ? ` · owners: ${state.allowed_owners.join(", ")}` : ""}
            </span>
            {state.has_more && (
              <button
                type="button"
                data-testid="repo-cargar-mas"
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  cargar(busq, next, true);
                }}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                Cargar más
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
