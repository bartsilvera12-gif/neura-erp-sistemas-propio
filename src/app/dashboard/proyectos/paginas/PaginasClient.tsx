"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Pagina = {
  id: string;
  titulo: string;
  cliente: string;
  vendedor: string;
  tipo_web: string;
  dominio: string;
};

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Construye un href navegable desde el dominio cargado (o null si no parece válido). */
function dominioHref(dominio: string): string | null {
  const d = dominio.trim();
  if (!d) return null;
  const withProto = /^https?:\/\//i.test(d) ? d : `https://${d}`;
  try {
    const u = new URL(withProto);
    // Host con al menos un punto y algo antes del TLD (descarta ".com" suelto).
    if (!u.hostname.includes(".") || u.hostname.startsWith(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function dominioLabel(dominio: string): string {
  return dominio.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export default function PaginasClient() {
  const [paginas, setPaginas] = useState<Pagina[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchWithSupabaseSession("/api/proyectos/paginas", { cache: "no-store" });
        const j = (await res.json()) as { success?: boolean; data?: { paginas: Pagina[] }; error?: string };
        if (!res.ok || j.success !== true || !j.data) throw new Error(j.error ?? `Error ${res.status}`);
        if (!cancel) setPaginas(j.data.paginas);
      } catch (e) {
        if (!cancel) setErr(e instanceof Error ? e.message : "Error al cargar");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const tiposDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const p of paginas) if (p.tipo_web) set.add(p.tipo_web);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [paginas]);

  const filtradas = useMemo(() => {
    const needle = norm(q.trim());
    return paginas.filter((p) => {
      if (tipo && p.tipo_web !== tipo) return false;
      if (needle) {
        const hay = norm(`${p.cliente} ${p.titulo} ${p.vendedor} ${p.tipo_web} ${p.dominio}`);
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [paginas, q, tipo]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FAEB2]">Catálogo</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Páginas</h1>
          <p className="text-sm text-slate-500">
            Todas las páginas web que hicimos: cliente, vendedor, rubro y acceso al sitio.
          </p>
        </div>
        <Link
          href="/dashboard/proyectos"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Volver al tablero
        </Link>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
        <input
          type="search"
          placeholder="Buscar por cliente, rubro, vendedor o dominio…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        >
          <option value="">Todos los rubros</option>
          {tiposDisponibles.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {(q || tipo) && (
          <button
            onClick={() => {
              setQ("");
              setTipo("");
            }}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">Cargando…</div>
        ) : err ? (
          <div className="py-16 text-center text-sm text-red-600">{err}</div>
        ) : filtradas.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            {paginas.length === 0 ? "Todavía no hay páginas web cargadas." : "No hay páginas para los filtros."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70">
                <tr>
                  {["Cliente / Empresa", "Vendedor", "Tipo de página", "Acceso al sitio"].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtradas.map((p) => {
                  const href = dominioHref(p.dominio);
                  return (
                    <tr key={p.id} className="hover:bg-[#4FAEB2]/[0.04]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/proyectos/${p.id}`}
                          className="font-semibold text-slate-800 hover:text-[#3F8E91] hover:underline"
                        >
                          {p.cliente}
                        </Link>
                        {p.titulo && p.titulo !== p.cliente ? (
                          <p className="text-[11px] text-slate-400">{p.titulo}</p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{p.vendedor}</td>
                      <td className="px-4 py-3">
                        {p.tipo_web ? (
                          <span className="inline-flex items-center rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-0.5 text-xs font-semibold text-[#3F8E91]">
                            {p.tipo_web}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-medium text-[#3F8E91] hover:underline"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                            {dominioLabel(p.dominio)}
                          </a>
                        ) : p.dominio ? (
                          <span className="text-slate-500">{dominioLabel(p.dominio)}</span>
                        ) : (
                          <span className="text-slate-300">— sin cargar</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50/70">
                <tr>
                  <td className="px-4 py-2.5 text-xs font-semibold text-slate-600" colSpan={4}>
                    {filtradas.length} página{filtradas.length === 1 ? "" : "s"}
                    {filtradas.length !== paginas.length ? ` de ${paginas.length}` : ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
