"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Search,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import ArticuloMarkdown from "@/components/ayuda/ArticuloMarkdown";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { coincideBusqueda, tokenizarBusqueda } from "@/lib/proyectos/busqueda";
import { formatBytes, type AyudaAdjunto, type AyudaArticulo } from "@/app/configuracion/ayuda/types";

type Relacionado = { id: string; slug: string; titulo: string; categoria_nombre: string | null };

/**
 * Artículo de la Ayuda en línea.
 *
 * Layout de dos columnas: a la izquierda los artículos de la misma categoría
 * —o el resto de la base si el artículo está solo— para poder saltar sin
 * volver a la portada, y a la derecha el contenido. Arriba queda el buscador,
 * porque la duda suele mutar mientras se lee.
 */

const TEAL_OSCURO = "#0B3A3D";

export default function ArticuloClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [articulo, setArticulo] = useState<AyudaArticulo | null>(null);
  const [relacionados, setRelacionados] = useState<Relacionado[]>([]);
  const [origenLista, setOrigenLista] = useState<"categoria" | "otros">("categoria");
  const [adjuntos, setAdjuntos] = useState<AyudaAdjunto[]>([]);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [miFeedback, setMiFeedback] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sugeridos, setSugeridos] = useState<Relacionado[]>([]);
  const cajaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await apiFetch(`/api/ayuda/${encodeURIComponent(slug)}`);
        const j = await r.json();
        if (cancelado) return;
        if (!r.ok || !j?.success) {
          setError(j?.error ?? `Error ${r.status}`);
          return;
        }
        setArticulo(j.data.articulo as AyudaArticulo);
        setRelacionados((j.data.relacionados ?? []) as Relacionado[]);
        setOrigenLista((j.data.relacionados_origen ?? "categoria") as "categoria" | "otros");
        setAdjuntos((j.data.adjuntos ?? []) as AyudaAdjunto[]);
        setMiFeedback(j.data.mi_feedback ?? null);
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : "Error de red");
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [slug]);

  /** El buscador de arriba pega contra el listado, para poder saltar sin volver. */
  useEffect(() => {
    const q = busqueda.trim();
    if (!q) {
      setSugeridos([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/ayuda?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (r.ok && j?.success) {
          const tokens = tokenizarBusqueda(q);
          const items = (j.data.articulos as Relacionado[])
            .filter((a) => a.slug !== slug)
            .sort((a, b) => {
              // Los que matchean por título arriba: el servidor también trae los
              // que sólo coinciden dentro del texto.
              const ta = coincideBusqueda(tokens, a.titulo) ? 0 : 1;
              const tb = coincideBusqueda(tokens, b.titulo) ? 0 : 1;
              return ta - tb;
            });
          setSugeridos(items.slice(0, 6));
        }
      } catch {
        /* silencioso: el buscador es un extra, no la razón de esta pantalla */
      }
    }, 280);
    return () => clearTimeout(t);
  }, [busqueda, slug]);

  useEffect(() => {
    const alClickear = (e: MouseEvent) => {
      if (!cajaRef.current?.contains(e.target as Node)) setSugeridos([]);
    };
    document.addEventListener("mousedown", alClickear);
    return () => document.removeEventListener("mousedown", alClickear);
  }, []);

  const votar = useCallback(
    async (util: boolean) => {
      const previo = miFeedback;
      setMiFeedback(util);
      try {
        const r = await apiFetch(`/api/ayuda/${encodeURIComponent(slug)}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ util }),
        });
        if (!r.ok) setMiFeedback(previo);
      } catch {
        setMiFeedback(previo);
      }
    },
    [slug, miFeedback]
  );

  const abrirAdjunto = useCallback(
    async (adj: AyudaAdjunto) => {
      setDescargando(adj.id);
      try {
        const r = await apiFetch(`/api/ayuda/${encodeURIComponent(slug)}/adjuntos/${adj.id}?download=1`);
        const j = await r.json();
        if (r.ok && j?.success && j.data?.url) {
          window.open(j.data.url as string, "_blank", "noopener,noreferrer");
        }
      } catch {
        /* silencioso: si falla, el usuario reintenta */
      } finally {
        setDescargando(null);
      }
    },
    [slug]
  );

  const tituloLista = useMemo(() => {
    if (origenLista === "otros") return "Otros artículos";
    return articulo?.categoria_nombre ? `Artículos de ${articulo.categoria_nombre}` : "Artículos relacionados";
  }, [origenLista, articulo]);

  const buscador = (
    <div ref={cajaRef} className="relative mx-auto w-full max-w-2xl">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]"
      />
      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setBusqueda("");
          if (e.key === "Enter" && sugeridos[0]) router.push(`/ayuda/${encodeURIComponent(sugeridos[0].slug)}`);
        }}
        placeholder="Ingresá acá tu consulta"
        aria-label="Buscar en la ayuda"
        className="w-full rounded-xl border border-white/20 bg-white/95 py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/30"
      />
      {sugeridos.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {sugeridos.map((a) => (
            <li key={a.id}>
              <Link
                href={`/ayuda/${encodeURIComponent(a.slug)}`}
                onClick={() => setBusqueda("")}
                className="block px-4 py-2.5 transition-colors hover:bg-[#4FAEB2]/10"
              >
                <span className="block truncate text-sm font-medium text-slate-800">{a.titulo}</span>
                <span className="block truncate text-[11px] text-slate-400">
                  {a.categoria_nombre ?? "Sin categoría"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando artículo…
      </div>
    );
  }

  if (error || !articulo) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 py-16 text-center">
        <p className="text-sm font-semibold text-slate-700">{error ?? "Artículo no encontrado"}</p>
        <Link
          href="/ayuda"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a la Ayuda
        </Link>
      </div>
    );
  }

  return (
    <div className="-mx-4 -mt-4 md:-mx-6 md:-mt-6">
      {/* Banda superior con el buscador */}
      <div
        className="px-4 py-4 md:px-6"
        style={{ background: `linear-gradient(160deg, ${TEAL_OSCURO} 0%, #17575A 60%, #2F6E71 100%)` }}
      >
        {buscador}
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-5 md:px-6">
        {/* Breadcrumb */}
        <nav aria-label="Ruta" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <Link
            href="/ayuda"
            className="inline-flex items-center gap-1.5 font-medium transition-colors hover:text-[#2F6E71]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Inicio
          </Link>
          {articulo.categoria_nombre ? (
            <>
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-300" />
              <span className="text-slate-500">{articulo.categoria_nombre}</span>
            </>
          ) : null}
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-300" />
          <span className="font-semibold text-slate-800">{articulo.titulo}</span>
        </nav>

        <div className="grid gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
          {/* Columna izquierda: por dónde seguir */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <h2 className="border-b border-slate-100 pb-2 text-sm font-bold text-[#0B3A3D]">{tituloLista}</h2>
              {relacionados.length === 0 ? (
                <p className="px-1 py-3 text-xs text-slate-400">
                  Es el único artículo cargado por ahora.
                </p>
              ) : (
                <ul className="mt-1 divide-y divide-slate-100">
                  {relacionados.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/ayuda/${encodeURIComponent(a.slug)}`}
                        className="block py-2.5 pl-1 pr-1 text-[13px] leading-snug text-slate-600 transition-colors hover:text-[#2F6E71]"
                      >
                        {a.titulo}
                        {origenLista === "otros" && a.categoria_nombre ? (
                          <span className="mt-0.5 block text-[11px] text-slate-400">{a.categoria_nombre}</span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Columna derecha: el artículo */}
          <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 md:p-7">
            <header className="border-b border-slate-100 pb-4">
              <h1 className="text-2xl font-bold tracking-tight text-[#0B3A3D] md:text-[28px]">
                {articulo.titulo}
              </h1>
              {articulo.resumen ? (
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{articulo.resumen}</p>
              ) : null}
            </header>

            <div className="pt-5">
              <ArticuloMarkdown>{articulo.contenido_md}</ArticuloMarkdown>
            </div>

            {adjuntos.length > 0 ? (
              <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Documentos adjuntos
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {adjuntos.map((adj) => (
                    <li key={adj.id}>
                      <button
                        type="button"
                        onClick={() => void abrirAdjunto(adj)}
                        disabled={descargando === adj.id}
                        className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-[#4FAEB2]/60 disabled:opacity-60"
                      >
                        <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-[#2F6E71]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-800">{adj.nombre}</span>
                          {adj.size_bytes ? (
                            <span className="block text-[11px] text-slate-400">{formatBytes(adj.size_bytes)}</span>
                          ) : null}
                        </span>
                        {descargando === adj.id ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
                        ) : (
                          <Download aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-300" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <footer className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <span className="text-xs text-slate-500">¿Te sirvió este artículo?</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void votar(true)}
                  aria-pressed={miFeedback === true}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    miFeedback === true
                      ? "border-[#4FAEB2] bg-[#4FAEB2]/12 text-[#2F6E71]"
                      : "border-slate-200 text-slate-600 hover:border-[#4FAEB2]/60"
                  }`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  Sí
                </button>
                <button
                  type="button"
                  onClick={() => void votar(false)}
                  aria-pressed={miFeedback === false}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    miFeedback === false
                      ? "border-rose-300 bg-rose-50 text-rose-600"
                      : "border-slate-200 text-slate-600 hover:border-rose-300"
                  }`}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  No
                </button>
              </div>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
