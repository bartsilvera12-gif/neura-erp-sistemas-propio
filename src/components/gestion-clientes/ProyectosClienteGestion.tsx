"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, FolderKanban, Lock, PauseCircle, RefreshCw } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type ProyectoFila = {
  id: string;
  titulo?: string | null;
  archivado?: boolean | null;
  bloqueado?: boolean | null;
  etapa_desarrollo?: string | null;
  fecha_prometida?: string | null;
  fecha_entrega?: string | null;
  created_at?: string | null;
  proyecto_estado?: { nombre?: string | null; color?: string | null } | null;
  proyecto_tipo?: { nombre?: string | null } | null;
  project_manager?: { nombre?: string | null } | null;
  responsable_tecnico?: { nombre?: string | null } | null;
};

type Estado =
  | { tipo: "cargando" }
  | { tipo: "sin_permiso" }
  | { tipo: "error" }
  | { tipo: "listo"; activos: ProyectoFila[]; archivados: ProyectoFila[] };

function fecha(iso?: string | null) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : null;
}

function nombreCorto(n?: string | null) {
  const p = (n ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return null;
  const t = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return p.length > 2 ? `${t(p[0])} ${t(p[p.length > 3 ? 2 : 1])}` : p.map(t).join(" ");
}

async function traer(clienteId: string, archivado: boolean): Promise<{ status: number; filas: ProyectoFila[] }> {
  const res = await fetchWithSupabaseSession(`/api/proyectos?cliente_id=${encodeURIComponent(clienteId)}&archivado=${archivado ? 1 : 0}`, {
    cache: "no-store",
  });
  const j = (await res.json().catch(() => null)) as { success?: boolean; data?: ProyectoFila[] } | null;
  return { status: res.status, filas: res.ok && j?.success && Array.isArray(j.data) ? j.data : [] };
}

/**
 * Proyectos del cliente dentro de Gestión de clientes.
 *
 * Usa la misma API y el mismo permiso que la pestaña Proyectos de la ficha
 * (`/api/proyectos?cliente_id=`): no hay otra fuente ni otro permiso. Quien no
 * tiene acceso a Proyectos ve el aviso en lugar de la lista.
 */
export function ProyectosClienteGestion({ clienteId }: { clienteId: string }) {
  const [abierto, setAbierto] = useState(true);
  const [verArchivados, setVerArchivados] = useState(false);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

  const cargar = useCallback(
    async (vivo: () => boolean = () => true) => {
      setEstado({ tipo: "cargando" });
      try {
        const [a, b] = await Promise.all([traer(clienteId, false), traer(clienteId, true)]);
        if (!vivo()) return;
        if (a.status === 403) return setEstado({ tipo: "sin_permiso" });
        if (a.status >= 400) return setEstado({ tipo: "error" });
        setEstado({ tipo: "listo", activos: a.filas, archivados: b.filas });
      } catch {
        if (vivo()) setEstado({ tipo: "error" });
      }
    },
    [clienteId]
  );

  useEffect(() => {
    let vivo = true;
    void cargar(() => vivo);
    return () => {
      vivo = false;
    };
  }, [cargar]);

  const activos = estado.tipo === "listo" ? estado.activos : [];
  const archivados = estado.tipo === "listo" ? estado.archivados : [];
  const enCurso = activos.filter((p) => p.etapa_desarrollo !== "finalizado").length;
  const lista = verArchivados ? [...activos, ...archivados] : activos;

  return (
    <section>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 border-b border-slate-200/60 bg-slate-50/90 px-3 py-2.5 text-left transition-colors hover:bg-[#4FAEB2]/[0.04] sm:px-4"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="inline-flex shrink-0 text-[#4FAEB2]" aria-hidden>
            {abierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Proyectos</span>
          <span className="hidden text-[10px] font-normal text-slate-400 sm:inline">del cliente</span>
          {estado.tipo === "listo" ? (
            <>
              <span className="hidden h-3 w-px bg-slate-200 sm:inline" />
              <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700">
                {activos.length} {activos.length === 1 ? "proyecto" : "proyectos"}
              </span>
              {enCurso > 0 ? (
                <span className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sky-700">
                  {enCurso} en curso
                </span>
              ) : null}
              {archivados.length > 0 ? (
                <span className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
                  {archivados.length} archivado{archivados.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        <span className="shrink-0 text-[10px] font-semibold text-[#3F8E91]">{abierto ? "Ocultar" : "Ver proyectos"}</span>
      </button>

      {abierto ? (
        <div className="border-b border-slate-100 p-2 sm:p-3">
          {estado.tipo === "cargando" ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[92px] animate-pulse rounded-xl border border-slate-100 bg-slate-50" />
              ))}
            </div>
          ) : estado.tipo === "sin_permiso" ? (
            <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Tu usuario no tiene acceso al módulo Proyectos.
            </p>
          ) : estado.tipo === "error" ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
              No se pudieron cargar los proyectos.
              <button type="button" onClick={() => void cargar()} className="inline-flex items-center gap-1 font-semibold hover:underline">
                <RefreshCw className="h-3.5 w-3.5" /> Reintentar
              </button>
            </div>
          ) : lista.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center">
              <FolderKanban className="h-6 w-6 text-slate-300" aria-hidden />
              <p className="text-xs font-medium text-slate-600">Este cliente no tiene proyectos.</p>
              {archivados.length > 0 ? (
                <button type="button" onClick={() => setVerArchivados(true)} className="text-[11px] font-semibold text-[#3F8E91] hover:underline">
                  Ver {archivados.length} archivado{archivados.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {lista.map((p) => {
                  const color = p.proyecto_estado?.color ?? "#94a3b8";
                  const pm = nombreCorto(p.project_manager?.nombre);
                  const tec = nombreCorto(p.responsable_tecnico?.nombre);
                  const prometida = fecha(p.fecha_prometida);
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/dashboard/proyectos/${p.id}`}
                        className={`group relative block h-full overflow-hidden rounded-xl border bg-white py-2.5 pl-4 pr-3 no-underline shadow-sm transition hover:-translate-y-px hover:border-[#4FAEB2]/60 hover:shadow-md ${
                          p.archivado ? "border-dashed border-slate-200 opacity-70" : "border-slate-200"
                        }`}
                      >
                        <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} aria-hidden />
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-[13px] font-semibold text-slate-800 group-hover:text-[#2F6E71]" title={p.titulo ?? ""}>
                            {p.titulo || "(sin título)"}
                          </p>
                          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-[#4FAEB2]" aria-hidden />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ backgroundColor: `${color}1f`, color }}>
                            {p.proyecto_estado?.nombre ?? "Sin estado"}
                          </span>
                          {p.proyecto_tipo?.nombre ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-600">{p.proyecto_tipo.nombre}</span>
                          ) : null}
                          {p.bloqueado ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
                              <PauseCircle className="h-3 w-3" aria-hidden /> Pausado
                            </span>
                          ) : null}
                          {p.archivado ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-500">Archivado</span>
                          ) : null}
                        </div>
                        <p className="mt-1.5 truncate text-[11px] text-slate-500">
                          <span className="text-slate-400">PM:</span> {pm ?? "Sin asignar"}
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className="text-slate-400">Téc.:</span> {tec ?? "—"}
                          {prometida ? (
                            <>
                              <span className="mx-1.5 text-slate-300">·</span>
                              <span className="text-slate-400">Prometida:</span> {prometida}
                            </>
                          ) : null}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {archivados.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setVerArchivados((v) => !v)}
                  className="mt-2 text-[11px] font-semibold text-[#3F8E91] hover:underline"
                >
                  {verArchivados ? "Ocultar archivados" : `Ver ${archivados.length} archivado${archivados.length === 1 ? "" : "s"}`}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
