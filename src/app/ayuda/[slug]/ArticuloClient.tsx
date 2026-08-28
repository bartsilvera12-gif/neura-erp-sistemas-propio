"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import ArticuloMarkdown from "@/components/ayuda/ArticuloMarkdown";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import type { AyudaArticulo } from "@/app/configuracion/ayuda/types";

type Relacionado = { id: string; slug: string; titulo: string };

export default function ArticuloClient({ slug }: { slug: string }) {
  const [articulo, setArticulo] = useState<AyudaArticulo | null>(null);
  const [relacionados, setRelacionados] = useState<Relacionado[]>([]);
  const [miFeedback, setMiFeedback] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-12">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Link href="/ayuda" className="font-medium transition-colors hover:text-[#4FAEB2]">
          Ayuda en línea
        </Link>
        {articulo.categoria_nombre && (
          <>
            <span aria-hidden className="text-slate-300">
              /
            </span>
            <span className="font-medium text-slate-500">{articulo.categoria_nombre}</span>
          </>
        )}
      </nav>

      <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{articulo.titulo}</h1>
          {articulo.resumen && <p className="mt-1 text-sm text-slate-500">{articulo.resumen}</p>}
          <p className="mt-2 text-xs text-slate-400">
            Actualizado el {new Date(articulo.updated_at).toLocaleDateString("es-PY")}
          </p>
      </div>

      {/* Cuerpo */}
      <article className="rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-7">
        {articulo.contenido_md.trim() ? (
          <ArticuloMarkdown>{articulo.contenido_md}</ArticuloMarkdown>
        ) : (
          <p className="text-sm text-slate-400">Este artículo todavía no tiene contenido.</p>
        )}
      </article>

      {/* ¿Te sirvió? */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <p className="text-sm font-medium text-slate-600">
          {miFeedback === null ? "¿Te sirvió este artículo?" : "¡Gracias por avisar!"}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => votar(true)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
              miFeedback === true
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <ThumbsUp className="h-4 w-4" />
            Sí
          </button>
          <button
            type="button"
            onClick={() => votar(false)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
              miFeedback === false
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <ThumbsDown className="h-4 w-4" />
            No
          </button>
        </div>
      </div>

      {relacionados.length > 0 && (
        <div>
          <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
            Seguí leyendo
          </h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {relacionados.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/ayuda/${r.slug}`}
                  className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1 truncate">{r.titulo}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        href="/ayuda"
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/5"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a la Ayuda
      </Link>
    </div>
  );
}
