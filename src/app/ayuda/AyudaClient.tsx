"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Loader2, Search, X } from "lucide-react";
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
  /**
   * La base completa, cargada UNA sola vez. Antes cada tecla la reemplazaba con
   * la respuesta del servidor: la lista encogía y volvía a crecer, y con la
   * página scrolleada eso se veía como un temblor.
   */
  const [articulos, setArticulos] = useState<AyudaArticuloResumen[]>([]);
  /**
   * Ids que el servidor encontró para `busquedaActiva`. Sólo SUMAN: son los
   * artículos que coinciden dentro del texto, que es lo único que el cliente no
   * tiene cargado. Nunca quitan nada, así el listado no da saltos.
   */
  const [idsServidor, setIdsServidor] = useState<Set<string> | null>(null);
  const [categorias, setCategorias] = useState<CategoriaConteo[]>([]);
  const [loading, setLoading] = useState(true);
  const [buscandoServidor, setBuscandoServidor] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [busquedaActiva, setBusquedaActiva] = useState("");
  const [categoriaSel, setCategoriaSel] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  /** Carga inicial: todo el material visible para el rol, sin filtrar. */
  const cargarBase = useCallback(async () => {
    setError(null);
    try {
      const r = await apiFetch("/api/ayuda");
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

  /**
   * Resuelve una consulta y la publica ENTERA: el texto activo y los ids que el
   * servidor encontró en el cuerpo se aplican en la misma tanda.
   *
   * Publicarlos por separado era justamente el temblor: al teclear, el filtro
   * en memoria angostaba la lista y 300 ms después el servidor volvía a
   * agregarle los que coinciden dentro del texto. Con cada letra, la lista se
   * achicaba y crecía. Ahora cambia una sola vez, cuando está todo resuelto.
   */
  const buscarEnTexto = useCallback(async (q: string) => {
    if (!q) {
      setIdsServidor(null);
      setBusquedaActiva("");
      return;
    }
    setBuscandoServidor(true);
    try {
      const r = await apiFetch(`/api/ayuda?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (r.ok && j?.success) {
        setIdsServidor(new Set((j.data.articulos as AyudaArticuloResumen[]).map((a) => a.id)));
      } else {
        setIdsServidor(null);
      }
    } catch {
      // Si el servidor no contesta igual se aplica el filtro en memoria: es
      // preferible un resultado acotado a una pantalla que no reacciona.
      setIdsServidor(null);
    } finally {
      setBusquedaActiva(q);
      setBuscandoServidor(false);
    }
  }, []);

  useEffect(() => {
    void cargarBase();
  }, [cargarBase]);

  useEffect(() => {
    const t = setTimeout(() => {
      void buscarEnTexto(search.trim());
    }, 250);
    return () => clearTimeout(t);
  }, [search, buscarEnTexto]);

  /**
   * Los tokens salen de la consulta RESUELTA, no de lo que se está tecleando:
   * así el listado cambia una vez por búsqueda y no en cada pulsación.
   */
  const tokens = useMemo(() => tokenizarBusqueda(busquedaActiva), [busquedaActiva]);

  /**
   * Filtrar por una categoría MADRE tiene que traer también lo de sus hijas:
   * "Desarrollo" no tiene artículos propios, todos cuelgan de "Páginas Web".
   * Comparando sólo la categoría exacta, el filtro daba vacío.
   */
  const visibles = useMemo(() => {
    /*
      El texto se filtra en memoria (sin acentos y por tokens) y los ids del
      servidor SUMAN los que coinciden dentro del cuerpo. Los dos vienen de la
      misma consulta resuelta, así que el listado cambia de una sola vez.
    */
    const extras = idsServidor;
    const base =
      tokens.length === 0
        ? articulos
        : articulos.filter(
            (a) =>
              coincideBusqueda(tokens, `${a.titulo} ${a.resumen ?? ""} ${a.categoria_nombre ?? ""}`) ||
              extras?.has(a.id) === true
          );
    if (!categoriaSel) return base;
    const alcance = new Set([
      categoriaSel,
      ...categorias.filter((c) => c.parent_id === categoriaSel).map((c) => c.id),
    ]);
    return base.filter((a) => a.categoria_id && alcance.has(a.categoria_id));
  }, [articulos, categorias, categoriaSel, tokens, idsServidor]);

  /**
   * Agrupado por categoría, respetando la jerarquía: una categoría madre
   * muestra sus subcategorías anidadas debajo. `parent_id` null = primer nivel.
   */
  const porCategoria = useMemo(() => {
    const items = new Map<string, AyudaArticuloResumen[]>();
    for (const a of visibles) {
      const key = a.categoria_id ?? "__sin__";
      items.set(key, [...(items.get(key) ?? []), a]);
    }
    const meta = new Map(categorias.map((c) => [c.id, c]));
    const posicion = new Map(categorias.map((c, i) => [c.id, i]));
    const nombreDe = (id: string) =>
      meta.get(id)?.nombre ?? visibles.find((a) => a.categoria_id === id)?.categoria_nombre ?? "Otros";

    const hijasDe = new Map<string, string[]>();
    for (const c of categorias) {
      if (!c.parent_id) continue;
      hijasDe.set(c.parent_id, [...(hijasDe.get(c.parent_id) ?? []), c.id]);
    }

    /*
      Raíces = las categorías de primer nivel que tienen material propio MÁS las
      madres de las que sí lo tienen. Sin esa segunda parte, una madre sin
      artículos propios —"Desarrollo", que sólo contiene "Páginas Web"— quedaba
      fuera y su hija se dibujaba como si fuera de primer nivel.
      Con un filtro de categoría activo se muestra ese bloque solo.
    */
    const raices = categoriaSel
      ? [categoriaSel]
      : [
          ...new Set(
            [...items.keys()].map((id) => meta.get(id)?.parent_id ?? id)
          ),
        ];

    const bloques: {
      id: string;
      nombre: string;
      items: AyudaArticuloResumen[];
      hijas: { id: string; nombre: string; items: AyudaArticuloResumen[] }[];
    }[] = [];

    for (const id of raices) {
      const hijas = (hijasDe.get(id) ?? [])
        .filter((h) => (items.get(h) ?? []).length > 0)
        .sort((a, b) => (posicion.get(a) ?? 99) - (posicion.get(b) ?? 99))
        .map((h) => ({ id: h, nombre: nombreDe(h), items: items.get(h) ?? [] }));
      const propios = items.get(id) ?? [];
      if (propios.length === 0 && hijas.length === 0) continue;
      bloques.push({ id, nombre: nombreDe(id), items: propios, hijas });
    }

    return bloques.sort(
      (a, b) =>
        (posicion.get(a.id) ?? 99) - (posicion.get(b.id) ?? 99) ||
        a.nombre.localeCompare(b.nombre, "es")
    );
  }, [visibles, categorias, categoriaSel]);

  /**
   * Filtros de dos niveles. Arriba las categorías madre; al elegir una que
   * tiene subcategorías, aparece la segunda fila para afinar.
   *
   * El conteo de una madre SUMA el de sus hijas: si no, "Desarrollo", que no
   * tiene artículos propios, mostraría 0 aunque su subcategoría esté llena.
   */
  const totalDe = useCallback(
    (id: string) => {
      const propia = categorias.find((c) => c.id === id);
      return (
        (propia?.articulos ?? 0) +
        categorias.filter((h) => h.parent_id === id).reduce((n, h) => n + h.articulos, 0)
      );
    },
    [categorias]
  );

  const madres = useMemo(
    () =>
      categorias
        .filter((c) => !c.parent_id)
        .map((c) => ({ ...c, total: totalDe(c.id) }))
        .filter((c) => c.total > 0),
    [categorias, totalDe]
  );

  /** La madre del filtro activo: con una hija seleccionada, sigue siendo su madre. */
  const madreActiva = useMemo(() => {
    if (!categoriaSel) return "";
    const sel = categorias.find((c) => c.id === categoriaSel);
    return sel?.parent_id ?? categoriaSel;
  }, [categoriaSel, categorias]);

  const subcategorias = useMemo(
    () =>
      categorias
        .filter((c) => c.parent_id && c.parent_id === madreActiva && c.articulos > 0)
        .map((c) => ({ ...c, total: c.articulos })),
    [categorias, madreActiva]
  );

  /** Enter y el botón se saltean el respiro entre teclas y buscan ya. */
  const buscarYa = () => {
    void buscarEnTexto(search.trim());
  };

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
        <div className="relative mx-auto w-full max-w-4xl text-center">
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
      <div className="relative z-20 mx-auto -mt-16 w-full max-w-5xl px-4 md:-mt-20 md:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-[#0B3A3D]/10 md:p-5">
          <div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#4FAEB2]"
                />
                <input
                  ref={inputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      buscarYa();
                    } else if (e.key === "Escape") {
                      setSearch("");
                    }
                  }}
                  placeholder="Ingresá acá tu consulta"
                  aria-label="Buscar en la ayuda"
                  className="w-full rounded-xl border border-slate-200 bg-white py-3.5 pl-11 pr-10 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
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
                onClick={buscarYa}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#2F6E71] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#255A5C]"
              >
                <Search className="h-4 w-4" />
                Buscar
              </button>
            </div>
            {/*
              El aviso de "buscando" va como barra fina y absoluta: un spinner
              dentro del botón le cambiaba el ancho en cada consulta.
            */}
            <span
              aria-live="polite"
              className={`mt-1 block h-0.5 overflow-hidden rounded-full transition-opacity ${
                buscandoServidor ? "opacity-100" : "opacity-0"
              }`}
            >
              <span className="block h-full w-1/3 animate-pulse rounded-full bg-[#4FAEB2]" />
            </span>
          </div>

          {/* Filtros: categoría y, si la tiene, subcategoría */}
          {madres.length > 0 ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Categoría
                </span>
                <Chip activo={!categoriaSel} onClick={() => setCategoriaSel("")}>
                  Todas
                </Chip>
                {madres.map((c) => (
                  <Chip
                    key={c.id}
                    activo={madreActiva === c.id}
                    total={c.total}
                    onClick={() => setCategoriaSel(madreActiva === c.id ? "" : c.id)}
                  >
                    {c.nombre}
                  </Chip>
                ))}
              </div>

              {subcategorias.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Subcategoría
                  </span>
                  <Chip activo={categoriaSel === madreActiva} onClick={() => setCategoriaSel(madreActiva)}>
                    Todas
                  </Chip>
                  {subcategorias.map((h) => (
                    <Chip
                      key={h.id}
                      activo={categoriaSel === h.id}
                      total={h.total}
                      onClick={() => setCategoriaSel(categoriaSel === h.id ? madreActiva : h.id)}
                    >
                      {h.nombre}
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Listado ── */}
      {/*
        `min-h` es lo que evita el salto al escribir: cuando el resultado se
        achica, la página deja de acortarse de golpe y el navegador no tiene que
        reacomodar el scroll.
      */}
      <div className="mx-auto w-full min-h-[70vh] max-w-5xl px-4 pb-16 pt-10 md:px-6">
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
          <div className="space-y-10">
            {/* Renglón fijo: si apareciera y desapareciera, correría todo lo de abajo. */}
            <p className="h-4 text-xs text-slate-500">
              {busquedaActiva ? (
                <>
                  {visibles.length} {visibles.length === 1 ? "resultado" : "resultados"} para{" "}
                  <strong className="font-semibold text-slate-700">“{busquedaActiva}”</strong>
                </>
              ) : null}
            </p>

            {porCategoria.map((g) => (
              <section key={g.id}>
                <div className="mb-4 text-center">
                  <h2 className="text-xl font-bold tracking-tight text-[#0B3A3D] md:text-2xl">{g.nombre}</h2>
                  <p className="mt-0.5 text-[12px] text-slate-400">
                    {(() => {
                      const n = g.items.length + g.hijas.reduce((t, h) => t + h.items.length, 0);
                      return `${n} ${n === 1 ? "artículo" : "artículos"}`;
                    })()}
                  </p>
                  <span
                    aria-hidden="true"
                    className="mx-auto mt-2.5 block h-0.5 w-10 rounded-full bg-[#4FAEB2]"
                  />
                </div>
                {g.hijas.map((h) => (
                  <div key={h.id} className="mb-5">
                    <div className="mb-2.5 flex items-center gap-2.5">
                      <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#2F6E71]">
                        {h.nombre}
                      </h3>
                      <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
                    </div>
                    <ul className="space-y-3">
                      {h.items.map((a) => (
                        <li key={a.id}>
                          <ArticuloCard articulo={a} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <ul className="space-y-3">
                  {g.items.map((a) => (
                    <li key={a.id}>
                      <ArticuloCard articulo={a} />
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

/** Chip de filtro. Mismo control para categoría y subcategoría. */
function Chip({
  activo,
  total,
  onClick,
  children,
}: {
  activo: boolean;
  total?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
        activo
          ? "border-[#4FAEB2] bg-[#4FAEB2]/12 font-semibold text-[#2F6E71]"
          : "border-slate-200 text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
      }`}
    >
      {children}
      {total != null ? <span className="ml-1.5 text-[11px] text-slate-400">{total}</span> : null}
    </button>
  );
}

/** Tarjeta de artículo del índice. La usan el nivel madre y las subcategorías. */
function ArticuloCard({ articulo }: { articulo: AyudaArticuloResumen }) {
  return (
    <SpotlightCard
      spotlightColor="rgba(79, 174, 178, 0.10)"
      className="h-full rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md hover:shadow-[#0B3A3D]/5"
    >
      <Link
        href={`/ayuda/${encodeURIComponent(articulo.slug)}`}
        className="group flex h-full items-center gap-5 px-6 py-5"
      >
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#4FAEB2]/12 text-[#2F6E71] transition-colors group-hover:bg-[#4FAEB2]/20"
        >
          <BookOpen className="h-[22px] w-[22px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold leading-snug text-slate-900 transition-colors group-hover:text-[#2F6E71]">
            {articulo.titulo}
          </span>
          {articulo.resumen ? (
            <span className="mt-1 block line-clamp-2 text-sm leading-relaxed text-slate-500">
              {articulo.resumen}
            </span>
          ) : null}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#4FAEB2]"
        />
      </Link>
    </SpotlightCard>
  );
}
