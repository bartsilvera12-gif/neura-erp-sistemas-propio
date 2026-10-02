"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Network, Settings } from "lucide-react";
import * as dagre from "@dagrejs/dagre";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

type Nodo = {
  id: string;
  parent_id: string | null;
  titulo: string;
  nombre_persona: string | null;
  orden: number;
  color: string | null;
  foto_url: string | null;
  jefes_extra: string[];
};

const NODE_W = 190;
const NODE_H = 96;

function iniciales(n: { nombre_persona: string | null; titulo: string }): string {
  const base = (n.nombre_persona || n.titulo || "").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type Layout = {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  paths: string[];
};

function calcularLayout(nodos: Nodo[]): Layout | null {
  if (nodos.length === 0) return null;
  const byId = new Map(nodos.map((n) => [n.id, n]));

  // Conjunto de jefes por nodo = parent_id + co-jefes (que existan).
  const jefesOf = new Map<string, string[]>();
  for (const n of nodos) {
    const set = new Set<string>();
    if (n.parent_id && byId.has(n.parent_id) && n.parent_id !== n.id) set.add(n.parent_id);
    for (const j of n.jefes_extra ?? []) if (byId.has(j) && j !== n.id) set.add(j);
    jefesOf.set(n.id, [...set]);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 72, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodos) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const n of nodos) for (const j of jefesOf.get(n.id)!) g.setEdge(j, n.id);
  dagre.layout(g);

  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodos) {
    const nd = g.node(n.id);
    pos.set(n.id, { x: nd.x, y: nd.y });
  }
  const graph = g.graph();

  // Conectores: agrupo los nodos por su conjunto de jefes → barra compartida.
  const bars = new Map<string, { jefes: string[]; kids: string[] }>();
  for (const n of nodos) {
    const js = jefesOf.get(n.id)!;
    if (!js.length) continue;
    const key = [...js].sort().join("|");
    if (!bars.has(key)) bars.set(key, { jefes: js, kids: [] });
    bars.get(key)!.kids.push(n.id);
  }

  const cx = (id: string) => pos.get(id)!.x;
  const top = (id: string) => pos.get(id)!.y - NODE_H / 2;
  const bot = (id: string) => pos.get(id)!.y + NODE_H / 2;

  const paths: string[] = [];
  for (const { jefes, kids } of bars.values()) {
    const kxs = kids.map(cx);
    const jxs = jefes.map(cx);
    const barY = Math.min(...kids.map(top)) - 32;
    const sx = Math.min(...kxs, ...jxs);
    const ex = Math.max(...kxs, ...jxs);
    paths.push(`M${sx},${barY} L${ex},${barY}`);
    for (const j of jefes) paths.push(`M${cx(j)},${bot(j)} L${cx(j)},${barY}`);
    for (const k of kids) paths.push(`M${cx(k)},${barY} L${cx(k)},${top(k)}`);
  }

  return { pos, width: graph.width ?? 0, height: graph.height ?? 0, paths };
}

function Caja({ nodo }: { nodo: Nodo }) {
  const accent = nodo.color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(nodo.color) ? nodo.color : "#4FAEB2";
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center shadow-sm"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div
        className="flex aspect-square h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-sm font-bold text-slate-500"
        style={{ border: `2px solid ${accent}` }}
      >
        {nodo.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={nodo.foto_url} alt={nodo.nombre_persona ?? nodo.titulo} className="h-full w-full object-cover" />
        ) : (
          <span>{iniciales(nodo)}</span>
        )}
      </div>
      <span className="text-[13px] font-bold leading-tight text-slate-900">{nodo.titulo}</span>
      {nodo.nombre_persona ? <span className="text-[11px] leading-tight text-slate-500">{nodo.nombre_persona}</span> : null}
    </div>
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

  const layout = useMemo(() => {
    try {
      return calcularLayout(nodos);
    } catch {
      return null;
    }
  }, [nodos]);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#4FAEB2]/12 text-[#3F8E91]">
          <Network className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Organigrama</h1>
          <p className="text-sm text-slate-500">Estructura organizacional de la empresa.</p>
        </div>
      </header>

      {cargando ? (
        <p className="py-16 text-center text-sm text-slate-400">Cargando organigrama…</p>
      ) : error ? (
        <p className="py-16 text-center text-sm text-red-500">{error}</p>
      ) : !layout ? (
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
        <div className="overflow-auto rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
            <svg
              className="absolute left-0 top-0"
              width={layout.width}
              height={layout.height}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth={2}
            >
              {layout.paths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </svg>
            {nodos.map((n) => {
              const p = layout.pos.get(n.id);
              if (!p) return null;
              return (
                <div
                  key={n.id}
                  className="absolute"
                  style={{ left: p.x - NODE_W / 2, top: p.y - NODE_H / 2, width: NODE_W, height: NODE_H }}
                >
                  <Caja nodo={n} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
