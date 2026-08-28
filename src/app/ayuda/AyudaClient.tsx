"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Loader2, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import type { AyudaArticuloResumen, AyudaCategoria } from "@/app/configuracion/ayuda/types";

type CategoriaConteo = AyudaCategoria & { articulos: number };

/**
 * Ayuda en línea — vista del equipo (`/ayuda`).
 * Solo lectura: la API ya filtra por rol y deja fuera los borradores.
 */
export default function AyudaClient() {
  const [articulos, setArticulos] = useState<AyudaArticuloResumen[]>([]);
  const [categorias, setCategorias] = useState<CategoriaConteo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [busquedaActiva, setBusquedaActiva] = useState("");
  const [categoriaSel, setCategoriaSel] = useState<string>("");

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/ayuda${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      setArticulos(j.data.articulos as AyudaArticuloResumen[]);
      setCategorias(j.data.categorias as CategoriaConteo[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  /** La búsqueda pega contra el servidor (busca dentro del texto), con un respiro entre teclas. */
  useEffect(() => {
    const t = setTimeout(() => {
      setBusquedaActiva(search.trim());
      load(search.trim());
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const visibles = useMemo(
    () => (categoriaSel ? articulos.filter((a) => a.categoria_id === categoriaSel) : articulos),
    [articulos, categoriaSel]
  );

  const porCategoria = useMemo(() => {
    const grupos = new Map<string, { nombre: string; items: AyudaArticuloResumen[] }>();
    for (const a of visibles) {
      const key = a.categoria_id ?? "__sin__";
      const g = grupos.get(key) ?? { nombre: a.categoria_nombre ?? "Otros", items: [] };
      g.items.push(a);
      grupos.set(key, g);
    }
    return Array.from(grupos.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [visibles]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-10">
      {/* Encabezado */}
      <div>
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
            />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
              Ayuda en línea
            </p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Procesos, políticas e información
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Todo lo que necesitás saber para trabajar sin depender de preguntar.
          </p>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="¿Qué necesitás saber? Ej.: comisiones, factura rechazada, cliente nuevo…"
          className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-11 text-[15px] shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Categorías */}
      {categorias.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoriaSel("")}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              categoriaSel === ""
                ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            Todo
          </button>
          {categorias
            .filter((c) => c.articulos > 0)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoriaSel(categoriaSel === c.id ? "" : c.id)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  categoriaSel === c.id
                    ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {c.nombre}
                <span className="ml-1.5 text-slate-400">{c.articulos}</span>
              </button>
            ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando…
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <BookOpen className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">
            {busquedaActiva ? "No encontramos nada con esa búsqueda" : "Todavía no hay artículos cargados"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            {busquedaActiva
              ? "Probá con otras palabras. Si el tema no está documentado, avisale a tu supervisor: eso también sirve."
              : "En cuanto se carguen los procesos y políticas, van a aparecer acá."}
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {porCategoria.map((grupo) => (
            <div key={grupo.nombre}>
              <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                {grupo.nombre}
              </h2>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {grupo.items.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/ayuda/${a.slug}`}
                      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-slate-800">{a.titulo}</p>
                        {a.resumen && (
                          <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{a.resumen}</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
