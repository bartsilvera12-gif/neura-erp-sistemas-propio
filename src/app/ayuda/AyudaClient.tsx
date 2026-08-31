"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, CornerDownLeft, Loader2, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { coincideBusqueda, tokenizarBusqueda } from "@/lib/proyectos/busqueda";
import BlurText from "@/components/reactbits/BlurText";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import type { AyudaArticuloResumen, AyudaCategoria } from "@/app/configuracion/ayuda/types";

type CategoriaConteo = AyudaCategoria & { articulos: number };

/**
 * Ayuda en línea — portada del lector (`/ayuda`).
 *
 * Buscador primero y navegación después: quien entra acá viene con una duda
 * concreta, no a explorar un índice. Por eso la búsqueda ocupa el centro, filtra
 * mientras se escribe y sugiere artículos antes de que se apriete nada.
 *
 * La búsqueda tiene DOS capas y se complementan:
 *  - En memoria (instantánea): título, resumen y categoría, sin acentos y por
 *    tokens sueltos, así "factura web" encuentra "Facturación de páginas web".
 *  - En el servidor (con un respiro entre teclas): busca además DENTRO del texto
 *    del artículo, que es lo único que no está cargado en el cliente.
 */

const TEAL_OSCURO = "#0B3A3D";

export default function AyudaClient() {
  const router = useRouter();
  const [articulos, setArticulos] = useState<AyudaArticuloResumen[]>([]);
  const [categorias, setCategorias] = useState<CategoriaConteo[]>([]);
  const [loading, setLoading] = useState(true);
  const [buscandoServidor, setBuscandoServidor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [busquedaActiva, setBusquedaActiva] = useState("");
  const [categoriaSel, setCategoriaSel] = useState<string>("");
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [resaltada, setResaltada] = useState(0);
  const cajaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (q: string) => {
    if (q) setBuscandoServidor(true);
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
      setBuscandoServidor(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setBusquedaActiva(search.trim());
      void load(search.trim());
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const alClickear = (e: MouseEvent) => {
      if (!cajaRef.current?.contains(e.target as Node)) setSugerenciasAbiertas(false);
    };
    document.addEventListener("mousedown", alClickear);
    return () => document.removeEventListener("mousedown", alClickear);
  }, []);

  /** Capa instantánea: filtra lo ya cargado mientras el servidor todavía viene en camino. */
  const tokens = useMemo(() => tokenizarBusqueda(search), [search]);
  const coincidencias = useMemo(() => {
    if (tokens.length === 0) return [];
    return articulos.filter((a) =>
      coincideBusqueda(tokens, `${a.titulo} ${a.resumen ?? ""} ${a.categoria_nombre ?? ""}`)
    );
  }, [articulos, tokens]);

  const sugerencias = useMemo(() => {
    if (tokens.length === 0) return [];
    // Lo que matchea por título/resumen primero; después lo que sólo matchea en
    // el cuerpo, que es lo que agrega el servidor y el usuario no ve venir.
    const ids = new Set(coincidencias.map((a) => a.id));
    return [...coincidencias, ...articulos.filter((a) => !ids.has(a.id))].slice(0, 6);
  }, [coincidencias, articulos, tokens]);

  useEffect(() => {
    setResaltada(0);
  }, [search]);

  const visibles = useMemo(
    () => (categoriaSel ? articulos.filter((a) => a.categoria_id === categoriaSel) : articulos),
    [articulos, categoriaSel]
  );

  const porCategoria = useMemo(() => {
    const grupos = new Map<string, { id: string; nombre: string; items: AyudaArticuloResumen[] }>();
    for (const a of visibles) {
      const key = a.categoria_id ?? "__sin__";
      const g = grupos.get(key) ?? { id: key, nombre: a.categoria_nombre ?? "Otros", items: [] };
      g.items.push(a);
      grupos.set(key, g);
    }
    const orden = new Map(categorias.map((c, i) => [c.id, i]));
    return [...grupos.values()].sort(
      (a, b) => (orden.get(a.id) ?? 99) - (orden.get(b.id) ?? 99) || a.nombre.localeCompare(b.nombre, "es")
    );
  }, [visibles, categorias]);

  /** Atajos: las categorías con más material, que es por donde suele empezar la duda. */
  const atajos = useMemo(
    () => categorias.filter((c) => c.articulos > 0).sort((a, b) => b.articulos - a.articulos).slice(0, 5),
    [categorias]
  );

  const irA = (slug: string) => router.push(`/ayuda/${encodeURIComponent(slug)}`);

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!sugerenciasAbiertas || sugerencias.length === 0) {
      if (e.key === "Escape") setSearch("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltada((i) => (i + 1) % sugerencias.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltada((i) => (i - 1 + sugerencias.length) % sugerencias.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      irA(sugerencias[resaltada].slug);
    } else if (e.key === "Escape") {
      setSugerenciasAbiertas(false);
    }
  }

  return (
    <div className="-mx-4 -mt-4 md:-mx-6 md:-mt-6">
      {/* ── Portada: título y buscador ── */}
      <section
        className="relative overflow-hidden px-4 pb-24 pt-12 md:px-6 md:pb-28 md:pt-16"
        style={{ background: `linear-gradient(160deg, ${TEAL_OSCURO} 0%, #17575A 55%, #2F6E71 100%)` }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#4FAEB2]/20 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-10 h-64 w-64 rounded-full bg-[#4FAEB2]/10 blur-3xl"
        />
        <div className="relative mx-auto w-full max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
            <BookOpen className="h-3.5 w-3.5" />
            Ayuda en línea
          </span>
          <BlurText
            text="¿Tenés dudas? Resolvelas acá"
            animateBy="words"
            delay={90}
            className="mt-3 justify-center text-3xl font-bold tracking-tight text-white md:text-[38px]"
          />
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/70">
            Procesos, políticas y precios del equipo. Escribí lo que necesitás y te llevamos al artículo.
          </p>
        </div>
      </section>

      {/* ── Buscador, montado sobre el borde de la portada ── */}
      <div className="relative z-20 mx-auto -mt-16 w-full max-w-3xl px-4 md:-mt-20 md:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-[#0B3A3D]/10 md:p-5">
          <div ref={cajaRef} className="relative">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]"
                />
                <input
                  ref={inputRef}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSugerenciasAbiertas(true);
                  }}
                  onFocus={() => setSugerenciasAbiertas(true)}
                  onKeyDown={alTeclear}
                  placeholder="Ingresá acá tu consulta"
                  aria-label="Buscar en la ayuda"
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-9 text-[15px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      inputRef.current?.focus();
                    }}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (sugerencias.length > 0) irA(sugerencias[0].slug);
                }}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#2F6E71] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#255A5C] disabled:opacity-50"
                disabled={sugerencias.length === 0}
              >
                {buscandoServidor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar
              </button>
            </div>

            {/* Sugerencias mientras se escribe */}
            {sugerenciasAbiertas && tokens.length > 0 ? (
              <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                {sugerencias.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-400">
                    Nada para “{search}”. Probá con otra palabra.
                  </p>
                ) : (
                  <ul className="max-h-80 overflow-y-auto py-1">
                    {sugerencias.map((a, i) => (
                      <li key={a.id}>
                        <Link
                          href={`/ayuda/${encodeURIComponent(a.slug)}`}
                          onMouseEnter={() => setResaltada(i)}
                          className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                            i === resaltada ? "bg-[#4FAEB2]/10" : "hover:bg-slate-50"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">{a.titulo}</span>
                            <span className="block truncate text-[11px] text-slate-400">
                              {a.categoria_nombre ?? "Sin categoría"}
                              {a.resumen ? ` · ${a.resumen}` : ""}
                            </span>
                          </span>
                          {i === resaltada ? (
                            <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          {/* Atajos: por dónde suele empezar la duda */}
          {atajos.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {atajos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategoriaSel(categoriaSel === c.id ? "" : c.id);
                    setSearch("");
                    setSugerenciasAbiertas(false);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                    categoriaSel === c.id
                      ? "border-[#4FAEB2] bg-[#4FAEB2]/12 font-semibold text-[#2F6E71]"
                      : "border-slate-200 text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
                  }`}
                >
                  {c.nombre}
                  <span className="ml-1.5 text-[11px] text-slate-400">{c.articulos}</span>
                </button>
              ))}
              {categoriaSel ? (
                <button
                  type="button"
                  onClick={() => setCategoriaSel("")}
                  className="rounded-full px-2 py-1.5 text-[12px] font-medium text-slate-400 transition-colors hover:text-rose-600"
                >
                  Quitar filtro
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Listado ── */}
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8 md:px-6">
        {error ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando…
          </div>
        ) : visibles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="text-sm font-semibold text-slate-800">
              {busquedaActiva ? `Sin resultados para “${busquedaActiva}”` : "Todavía no hay artículos"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
              {busquedaActiva
                ? "Probá con menos palabras o buscá por el nombre del proceso."
                : "Los artículos se cargan desde Configuración → Ayuda en línea."}
            </p>
          </div>
        ) : (
          <div className="space-y-7">
            {busquedaActiva ? (
              <p className="text-xs text-slate-500">
                {visibles.length} {visibles.length === 1 ? "resultado" : "resultados"} para{" "}
                <strong className="font-semibold text-slate-700">“{busquedaActiva}”</strong>
              </p>
            ) : null}

            {porCategoria.map((g) => (
              <section key={g.id}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#2F6E71]">
                    {g.nombre}
                  </h2>
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="text-[11px] text-slate-400">
                    {g.items.length} {g.items.length === 1 ? "artículo" : "artículos"}
                  </span>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {g.items.map((a) => (
                    <li key={a.id}>
                      <SpotlightCard
                        spotlightColor="rgba(79, 174, 178, 0.10)"
                        className="h-full rounded-xl border border-slate-200 bg-white"
                      >
                        <Link href={`/ayuda/${encodeURIComponent(a.slug)}`} className="flex h-full items-start gap-3 p-3.5">
                          <span
                            aria-hidden="true"
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#2F6E71]"
                          >
                            <BookOpen className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-900">{a.titulo}</span>
                            {a.resumen ? (
                              <span className="mt-0.5 block line-clamp-2 text-[12px] leading-relaxed text-slate-500">
                                {a.resumen}
                              </span>
                            ) : null}
                          </span>
                          <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
                        </Link>
                      </SpotlightCard>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
