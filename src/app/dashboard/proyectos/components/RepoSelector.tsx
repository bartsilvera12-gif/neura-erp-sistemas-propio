"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Github, Lock, Search, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { buscarRepos, type RepoItem } from "@/lib/github/repo-search";

type ApiResp<T> = { success: boolean; data?: T; error?: string };

/**
 * La lista de repos es la misma para todas las tarjetas y cambia poco, así que
 * se carga una sola vez por sesión de página y se comparte. El servidor además
 * la cachea, pero esto evita el ida y vuelta al abrir cada selector.
 */
let reposCache: RepoItem[] | null = null;
let reposPromesa: Promise<RepoItem[]> | null = null;

async function cargarRepos(): Promise<RepoItem[]> {
  if (reposCache) return reposCache;
  if (reposPromesa) return reposPromesa;
  reposPromesa = (async () => {
    const res = await fetchWithSupabaseSession("/api/github/repos", { cache: "no-store" });
    const j = (await res.json().catch(() => null)) as ApiResp<RepoItem[]> | null;
    if (!res.ok || !j?.success || !Array.isArray(j.data)) {
      reposPromesa = null;
      throw new Error(j?.error ?? "No se pudieron cargar los repositorios.");
    }
    reposCache = j.data;
    return reposCache;
  })();
  return reposPromesa;
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";

export default function RepoSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (fullName: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<RepoItem[]>(() => reposCache ?? []);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Carga perezosa: solo cuando se abre el selector por primera vez.
  useEffect(() => {
    if (!abierto || reposCache) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    cargarRepos()
      .then((r) => vivo && setRepos(r))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "Error"))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [abierto]);

  // Cerrar al hacer clic afuera.
  useEffect(() => {
    if (!abierto) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [abierto]);

  const resultados = useMemo(() => buscarRepos(repos, query, 30), [repos, query]);

  return (
    <div className="relative" ref={boxRef}>
      {value ? (
        <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
          <Github className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-900" title={value}>
            {value}
          </span>
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/10"
          >
            Cambiar
          </button>
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Quitar repositorio"
            title="Quitar"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className={`${inputCls} mt-1.5 flex items-center gap-2 text-left text-slate-400`}
        >
          <Github className="h-4 w-4 shrink-0" aria-hidden />
          Elegir repositorio…
        </button>
      )}

      {abierto ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar repositorio…"
              className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {cargando ? (
              <p className="px-3 py-3 text-[13px] text-slate-400">Cargando repositorios…</p>
            ) : error ? (
              <p className="px-3 py-3 text-[13px] text-rose-600">{error}</p>
            ) : resultados.length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-slate-400">Sin resultados.</p>
            ) : (
              resultados.map((r) => {
                const elegido = r.full_name === value;
                return (
                  <button
                    key={r.full_name}
                    type="button"
                    onClick={() => {
                      onChange(r.full_name);
                      setAbierto(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#4FAEB2]/10 ${
                      elegido ? "bg-[#4FAEB2]/10" : ""
                    }`}
                  >
                    <Github className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px] text-slate-900" title={r.full_name}>
                        {r.full_name}
                      </span>
                      {r.description ? (
                        <span className="block truncate text-[11.5px] text-slate-400" title={r.description}>
                          {r.description}
                        </span>
                      ) : null}
                    </span>
                    {r.private ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden title="Privado" />
                    ) : null}
                    {elegido ? <Check className="h-4 w-4 shrink-0 text-[#3F8E91]" aria-hidden /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
