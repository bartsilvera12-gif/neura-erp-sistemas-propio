"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Eye,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Search,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { ConfigMetricCard } from "@/components/config/global-config-primitives";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import AyudaArticuloEditor from "./AyudaArticuloEditor";
import {
  rolLabel,
  type AyudaAdminResponse,
  type AyudaArticulo,
  type AyudaCategoria,
  type AyudaSummary,
} from "./types";

type FiltroEstado = "todos" | "publicados" | "borradores";

const EMPTY_SUMMARY: AyudaSummary = {
  total: 0,
  publicados: 0,
  borradores: 0,
  categorias: 0,
  sin_categoria: 0,
};

/** Normaliza para buscar sin acentos ni mayúsculas. */
function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export default function ConfiguracionAyudaPage() {
  const [articulos, setArticulos] = useState<AyudaArticulo[]>([]);
  const [categorias, setCategorias] = useState<AyudaCategoria[]>([]);
  const [feedback, setFeedback] = useState<Record<string, { util: number; no_util: number }>>({});
  const [summary, setSummary] = useState<AyudaSummary>(EMPTY_SUMMARY);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fEstado, setFEstado] = useState<FiltroEstado>("todos");

  /** `undefined` = viendo la lista; `null` = artículo nuevo; objeto = editando. */
  const [editando, setEditando] = useState<AyudaArticulo | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await apiFetch("/api/configuracion/ayuda");
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setLoadError(j?.error ?? `Error ${r.status}`);
        return;
      }
      const data = j.data as AyudaAdminResponse;
      setArticulos(data.articulos);
      setCategorias(data.categorias);
      setFeedback(data.feedback ?? {});
      setSummary(data.summary);
      setRoles(data.meta?.roles_disponibles ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtrados = useMemo(() => {
    const q = norm(search);
    return articulos.filter((a) => {
      if (fCategoria && (a.categoria_id ?? "") !== fCategoria) return false;
      if (fEstado === "publicados" && !a.publicado) return false;
      if (fEstado === "borradores" && a.publicado) return false;
      if (!q) return true;
      const hay = norm([a.titulo, a.resumen ?? "", a.categoria_nombre ?? "", a.contenido_md].join(" "));
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [articulos, search, fCategoria, fEstado]);

  const porCategoria = useMemo(() => {
    const grupos = new Map<string, { nombre: string; items: AyudaArticulo[] }>();
    for (const a of filtrados) {
      const key = a.categoria_id ?? "__sin__";
      const nombre = a.categoria_nombre ?? "Sin categoría";
      const g = grupos.get(key) ?? { nombre, items: [] };
      g.items.push(a);
      grupos.set(key, g);
    }
    return Array.from(grupos.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [filtrados]);

  const onSaved = useCallback(() => {
    setEditando(undefined);
    load();
  }, [load]);

  return (
    <GlobalConfigSubpageShell
      title="Ayuda en línea"
      description="Procesos, políticas e información de la empresa. Lo que cargues acá lo consulta el equipo desde Ayuda."
      maxWidthClassName="max-w-none"
    >
      {editando !== undefined ? (
        <AyudaArticuloEditor
          articulo={editando}
          categorias={categorias}
          rolesDisponibles={roles}
          onClose={() => setEditando(undefined)}
          onSaved={onSaved}
        />
      ) : (
        <div className="space-y-5">
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ConfigMetricCard label="Artículos" value={summary.total} />
            <ConfigMetricCard label="Publicados" value={summary.publicados} />
            <ConfigMetricCard label="Borradores" value={summary.borradores} />
            <ConfigMetricCard label="Categorías" value={summary.categorias} />
          </div>

          {/* Acciones + filtros */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por título o contenido…"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
              />
            </div>
            <select
              value={fCategoria}
              onChange={(e) => setFCategoria(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
            >
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <select
              value={fEstado}
              onChange={(e) => setFEstado(e.target.value as FiltroEstado)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
            >
              <option value="todos">Todos</option>
              <option value="publicados">Publicados</option>
              <option value="borradores">Borradores</option>
            </select>

            <Link
              href="/ayuda"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" />
              Ver como el equipo
            </Link>
            <button
              type="button"
              onClick={() => setEditando(null)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
            >
              <Plus className="h-4 w-4" />
              Nuevo artículo
            </button>
          </div>

          {loadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loadError}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando artículos…
            </div>
          ) : articulos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-700">Todavía no hay artículos</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Arrancá por las preguntas que más te repiten los asesores: cómo cargar un cliente, cuándo
                una venta es comisionable, qué hacer con una factura rechazada.
              </p>
              <button
                type="button"
                onClick={() => setEditando(null)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
              >
                <Plus className="h-4 w-4" />
                Escribir el primero
              </button>
            </div>
          ) : filtrados.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-400">
              Ningún artículo coincide con la búsqueda.
            </p>
          ) : (
            <div className="space-y-6">
              {porCategoria.map((grupo) => (
                <div key={grupo.nombre}>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                    {grupo.nombre}
                    <span className="ml-2 font-medium normal-case tracking-normal text-slate-400">
                      {grupo.items.length}
                    </span>
                  </h3>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    {grupo.items.map((a) => {
                      const fb = feedback[a.id];
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => setEditando(a)}
                            className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-semibold text-slate-800">
                                  {a.titulo}
                                </span>
                                {!a.publicado && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                    Borrador
                                  </span>
                                )}
                                {a.roles_visibles.length > 0 && (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                    {a.roles_visibles.map(rolLabel).join(" · ")}
                                  </span>
                                )}
                                {a.modulo && (
                                  <span className="rounded-full bg-[#4FAEB2]/10 px-2 py-0.5 text-[10px] font-semibold text-[#3F8E91]">
                                    {a.modulo}
                                  </span>
                                )}
                              </div>
                              {a.resumen && (
                                <p className="mt-0.5 truncate text-xs text-slate-500">{a.resumen}</p>
                              )}
                            </div>

                            <div className="flex shrink-0 items-center gap-3 pt-0.5 text-xs text-slate-400">
                              <span className="inline-flex items-center gap-1" title="Vistas">
                                <Eye className="h-3.5 w-3.5" />
                                {a.vistas}
                              </span>
                              {fb && (fb.util > 0 || fb.no_util > 0) && (
                                <>
                                  <span className="inline-flex items-center gap-1 text-emerald-600">
                                    <ThumbsUp className="h-3.5 w-3.5" />
                                    {fb.util}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-red-500">
                                    <ThumbsDown className="h-3.5 w-3.5" />
                                    {fb.no_util}
                                  </span>
                                </>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </GlobalConfigSubpageShell>
  );
}
