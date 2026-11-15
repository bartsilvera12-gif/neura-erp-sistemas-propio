"use client";

/**
 * Selector de repositorio GitHub autorizado.
 *
 * Trae la whitelist desde `GET /api/qa/admin/repos` (gated por QA access) y
 * la presenta como combo con buscador. No muestra ni permite tipear repos
 * fuera de la lista. Reporta cambios por onChange(url).
 */

import { useEffect, useMemo, useState } from "react";

export type RepoOption = {
  url: string;
  owner: string;
  name: string;
  etiqueta: string;
  codebase: string;
  slug_sugerido: string | null;
  default_branch: string;
};

type Props = {
  value: string | null;
  onChange: (url: string | null, meta: RepoOption | null) => void;
  disabled?: boolean;
  testid?: string;
};

export default function RepoSelector({ value, onChange, disabled, testid }: Props) {
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busq, setBusq] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/qa/admin/repos", { cache: "no-store" });
        const text = await res.text();
        let body: { data?: RepoOption[]; error?: string } = {};
        try { body = text ? (JSON.parse(text) as typeof body) : {}; } catch { /* ignore */ }
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`);
          setRepos([]);
          return;
        }
        if (!cancel) setRepos(body.data ?? []);
      } catch (e) {
        if (!cancel) {
          setError(e instanceof Error ? e.message : "Error de red");
          setRepos([]);
        }
      }
    })();
    return () => { cancel = true; };
  }, []);

  const filtrados = useMemo(() => {
    if (!repos) return [];
    const q = busq.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) =>
      r.etiqueta.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.owner.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q)
    );
  }, [repos, busq]);

  const seleccion = useMemo(() => {
    if (!value || !repos) return null;
    return repos.find((r) => r.url === value) ?? null;
  }, [repos, value]);

  return (
    <div data-testid={testid ?? "repo-selector"} className="space-y-2">
      <div>
        <input
          data-testid="repo-busq"
          placeholder="Buscar repositorio por nombre…"
          value={busq}
          onChange={(e) => setBusq(e.target.value)}
          disabled={disabled}
          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
        />
      </div>
      {repos === null && <p className="text-xs text-slate-500">Cargando repositorios autorizados…</p>}
      {error && <p className="text-xs text-rose-600">Error: {error}</p>}
      {repos && repos.length === 0 && !error && (
        <p className="text-xs text-slate-500">No hay repositorios autorizados en el catálogo.</p>
      )}
      {repos && repos.length > 0 && (
        <select
          data-testid="repo-select"
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            const meta = v ? (repos.find((r) => r.url === v) ?? null) : null;
            onChange(v, meta);
          }}
          disabled={disabled}
          size={Math.min(6, Math.max(3, filtrados.length + 1))}
          className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono"
        >
          <option value="">— sin repositorio —</option>
          {filtrados.map((r) => (
            <option key={r.url} value={r.url} title={r.url}>
              {r.etiqueta} · {r.owner}/{r.name}
            </option>
          ))}
        </select>
      )}
      {seleccion && (
        <p className="text-[11px] text-slate-500" data-testid="repo-sel-info">
          <span className="font-mono">{seleccion.url}</span>
          {" · codebase="}<span className="font-mono">{seleccion.codebase}</span>
          {" · rama por defecto "}<span className="font-mono">{seleccion.default_branch}</span>
        </p>
      )}
    </div>
  );
}
