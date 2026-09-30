"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Network, Settings } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

type Nodo = {
  id: string;
  parent_id: string | null;
  titulo: string;
  nombre_persona: string | null;
  orden: number;
  color: string | null;
};

type ArbolNodo = Nodo & { hijos: ArbolNodo[] };

function construirArbol(nodos: Nodo[]): ArbolNodo[] {
  const byId = new Map<string, ArbolNodo>();
  nodos.forEach((n) => byId.set(n.id, { ...n, hijos: [] }));
  const roots: ArbolNodo[] = [];
  byId.forEach((n) => {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.hijos.push(n);
    else roots.push(n);
  });
  const ordenar = (arr: ArbolNodo[]) => {
    arr.sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo));
    arr.forEach((c) => ordenar(c.hijos));
  };
  ordenar(roots);
  return roots;
}

function Caja({ nodo }: { nodo: ArbolNodo }) {
  const accent = nodo.color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(nodo.color) ? nodo.color : "#4FAEB2";
  return (
    <div className="org-card" style={{ borderTopColor: accent }}>
      <span className="org-card-titulo">{nodo.titulo}</span>
      {nodo.nombre_persona ? <span className="org-card-persona">{nodo.nombre_persona}</span> : null}
    </div>
  );
}

function Rama({ nodo }: { nodo: ArbolNodo }) {
  return (
    <li>
      <Caja nodo={nodo} />
      {nodo.hijos.length > 0 && (
        <ul>
          {nodo.hijos.map((h) => (
            <Rama key={h.id} nodo={h} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrganigramaPage() {
  const [nodos, setNodos] = useState<Nodo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/organigrama", { cache: "no-store" });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error ?? "No se pudo cargar el organigrama");
      setNodos((json.data?.nodos ?? []) as Nodo[]);
      setCanEdit(Boolean(json.data?.meta?.can_edit));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const arbol = useMemo(() => construirArbol(nodos), [nodos]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <style>{ORG_CSS}</style>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#4FAEB2]/12 text-[#3F8E91]">
            <Network className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Organigrama</h1>
            <p className="text-sm text-slate-500">Estructura organizacional de la empresa.</p>
          </div>
        </div>
      </header>

      {cargando ? (
        <p className="py-16 text-center text-sm text-slate-400">Cargando organigrama…</p>
      ) : error ? (
        <p className="py-16 text-center text-sm text-red-500">{error}</p>
      ) : arbol.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-16 text-center">
          <p className="text-sm font-medium text-slate-600">Todavía no hay un organigrama cargado.</p>
          {canEdit && (
            <Link
              href="/configuracion/organigrama"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
            >
              <Settings className="h-4 w-4" />
              Crear organigrama
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="org-tree-wrap">
            <ul className="org-tree">
              {arbol.map((r) => (
                <Rama key={r.id} nodo={r} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** Árbol de organigrama en CSS puro (cajas + conectores). Clases prefijadas org- para no colisionar. */
const ORG_CSS = `
.org-tree-wrap { display: inline-block; min-width: 100%; }
.org-tree, .org-tree ul { display: flex; justify-content: center; padding: 0; margin: 0; list-style: none; }
.org-tree ul { padding-top: 22px; }
.org-tree li {
  position: relative;
  padding: 22px 10px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.org-tree li::before, .org-tree li::after {
  content: "";
  position: absolute;
  top: 0;
  right: 50%;
  width: 50%;
  height: 22px;
  border-top: 2px solid #cbd5e1;
}
.org-tree li::after { right: auto; left: 50%; border-left: 2px solid #cbd5e1; }
.org-tree li:only-child::before, .org-tree li:only-child::after { display: none; }
.org-tree li:only-child { padding-top: 22px; }
.org-tree li:first-child::before, .org-tree li:last-child::after { border: 0 none; }
.org-tree li:last-child::before { border-right: 2px solid #cbd5e1; border-radius: 0 6px 0 0; }
.org-tree li:first-child::after { border-radius: 6px 0 0 0; }
.org-tree > li { padding-top: 0; }
.org-tree > li::before, .org-tree > li::after { display: none; }
.org-tree ul ul::before {
  content: "";
  position: absolute;
  top: 0;
  left: 50%;
  width: 0;
  height: 22px;
  border-left: 2px solid #cbd5e1;
}
.org-card {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 150px;
  max-width: 220px;
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-top: 3px solid #4FAEB2;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}
.org-card-titulo { font-weight: 700; font-size: 13px; color: #0f172a; text-align: center; line-height: 1.25; }
.org-card-persona { font-size: 11px; color: #64748b; text-align: center; }
`;
