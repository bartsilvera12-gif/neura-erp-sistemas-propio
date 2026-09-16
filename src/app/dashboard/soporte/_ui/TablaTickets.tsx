"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, ChevronLeft, ChevronRight, Flame, Inbox, Search, X } from "lucide-react";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import {
  apiSoporte,
  catalogosEnMemoria,
  clientesEnMemoria,
  fechaHora,
  obtenerCatalogos,
  obtenerClientes,
  precargarTicket,
  type CatalogosConEquipo,
  type Persona,
} from "./api";
import { Aviso, Avatar, Cargando, Insignia, TONOS, TONO_AREA, TONO_ESTADO, Vacio, claseInput, type Tono } from "./ui";
import { SelectorBuscable } from "./SelectorBuscable";

export type PestanaDef = {
  id: string;
  etiqueta: string;
  estados: readonly string[] | null;
  /** Tickets con una revisión de QA sin terminar asignada a quien mira. */
  revision?: boolean;
};

type TicketLista = {
  id: string;
  numero: number;
  asunto: string;
  cliente_nombre: string | null;
  tipo_etiqueta: string;
  estado_codigo: string;
  estado_nombre: string;
  estado_color: string;
  prioridad_codigo: string;
  prioridad_nombre: string;
  prioridad_color: string;
  responsable: Persona | null;
  updated_at: string;
  sla: { estado: string };
};

type RespLista = {
  tickets: TicketLista[];
  total: number;
  pagina: number;
  por_pagina: number;
  por_estado: Record<string, number>;
  /** Sólo en "Mis tickets": revisiones de QA pendientes asignadas a quien mira. */
  revisiones_pendientes?: number;
};

const POR_PAGINA = 20;

/**
 * El último resultado de cada consulta. Volver al listado desde un ticket lo
 * pinta al instante con lo que había y lo refresca en silencio, en vez de
 * mostrar un esqueleto cada vez.
 */
const recordado = new Map<string, RespLista>();

function tonoPestana(p: PestanaDef): Tono {
  if (p.revision) return "violeta";
  if (!p.estados) return "turquesa";
  return TONO_ESTADO[p.estados[p.estados.length - 1]] ?? "turquesa";
}

/**
 * Listado de tickets con pestañas, filtros y paginación.
 *
 * El estado vive en la URL (?pestana=…&cliente_id=…): un refresh no pierde los
 * filtros, "atrás" funciona, y otras pantallas enlazan listados ya filtrados.
 */
export default function TablaTickets({
  pestanas,
  soloMios = false,
  ocultarResponsable = false,
}: {
  pestanas: readonly PestanaDef[];
  soloMios?: boolean;
  ocultarResponsable?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const pestana = pestanas.find((p) => p.id === params.get("pestana")) ?? pestanas[0];
  const filtros = {
    q: params.get("q") ?? "",
    cliente_id: params.get("cliente_id") ?? "",
    estado: params.get("estado") ?? "",
    tipo: params.get("tipo") ?? "",
    responsable_id: params.get("responsable_id") ?? "",
    prioridad: params.get("prioridad") ?? "",
  };
  const pagina = Math.max(1, Number(params.get("pagina") ?? "1") || 1);

  const consulta = useMemo(() => {
    const q = new URLSearchParams();
    if (pestana.estados) q.set("estados", pestana.estados.join(","));
    if (pestana.revision) q.set("revision", "1");
    for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
    if (soloMios) q.set("mios", "1");
    q.set("pagina", String(pagina));
    q.set("por_pagina", String(POR_PAGINA));
    return q.toString();
    // `params` resume todos los filtros de la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, soloMios, pestana]);

  const [cat, setCat] = useState<CatalogosConEquipo | null>(() => catalogosEnMemoria() ?? null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>(() => clientesEnMemoria() ?? []);
  const [datos, setDatos] = useState<RespLista | null>(() => recordado.get(consulta) ?? null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState(filtros.q);

  useEffect(() => {
    void obtenerCatalogos().then(setCat).catch((e: Error) => setError(e.message));
    void obtenerClientes().then(setClientes).catch(() => {});
  }, []);

  useEffect(() => {
    let vivo = true;
    const guardado = recordado.get(consulta);
    if (guardado) setDatos(guardado);
    setCargando(true);
    apiSoporte<RespLista>(`/api/soporte/tickets?${consulta}`)
      .then((r) => {
        recordado.set(consulta, r);
        if (vivo) {
          setDatos(r);
          setError(null);
        }
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [consulta]);

  const cambiar = useCallback(
    (cambios: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(cambios)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      if (!("pagina" in cambios)) q.delete("pagina");
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  useEffect(() => {
    if (texto === filtros.q) return;
    const t = window.setTimeout(() => cambiar({ q: texto.trim() || null }), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const contador = (p: PestanaDef) => {
    const pe = datos?.por_estado ?? {};
    if (p.revision) return datos?.revisiones_pendientes ?? 0;
    if (!p.estados) return Object.values(pe).reduce((s, n) => s + n, 0);
    return p.estados.reduce((s, e) => s + (pe[e] ?? 0), 0);
  };

  const op = useMemo(() => {
    const todos = (etq: string) => [{ value: "", label: etq }];
    return {
      estado: [...todos("Todos los estados"), ...(cat?.estados ?? []).filter((e) => e.activo).map((e) => ({ value: e.codigo, label: e.nombre }))],
      tipo: [...todos("Todos los tipos"), ...(cat?.tipos ?? []).filter((t) => t.activo).map((t) => ({ value: t.codigo, label: t.nombre }))],
      prioridad: [...todos("Toda prioridad"), ...(cat?.prioridades ?? []).filter((p) => p.activo).map((p) => ({ value: p.codigo, label: p.nombre }))],
      responsable: [...todos("Cualquier responsable"), ...(cat?.personas ?? []).map((u) => ({ value: u.id, label: u.nombre, detalle: u.area, tono: TONO_AREA[u.area] }))],
    };
  }, [cat]);

  const hayFiltros = Object.values(filtros).some(Boolean);
  const total = datos?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desde = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hasta = Math.min(total, pagina * POR_PAGINA);

  return (
    <div className="space-y-4">
      {/* Pestañas */}
      <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 p-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] backdrop-blur">
        {pestanas.map((p) => {
          const sel = p.id === pestana.id;
          const t = TONOS[tonoPestana(p)];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => cambiar({ pestana: p.id === pestanas[0].id ? null : p.id })}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold transition ${
                sel ? `${t.suave} ${t.texto} ring-1 ring-inset ${t.borde}` : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${t.solido}`} aria-hidden />
              {p.etiqueta}
              {datos ? (
                <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${sel ? "bg-white/70" : "bg-slate-100 text-slate-500"}`}>{contador(p)}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
        {/* Filtros */}
        <div className="grid gap-2 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/[0.05] via-white to-sky-50/40 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(130px,1fr))_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]" aria-hidden />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por asunto o #número…" aria-label="Buscar tickets" className={`${claseInput} pl-9`} />
          </label>
          <SelectorBuscable tam="sm" avatares ariaLabel="Cliente" opciones={[{ value: "", label: "Todos los clientes" }, ...clientes.map((c) => ({ value: c.id, label: c.nombre }))]} value={filtros.cliente_id} onChange={(v) => cambiar({ cliente_id: v || null })} placeholder="Todos los clientes" buscarPlaceholder="Buscar cliente…" vacio="Ningún cliente coincide" />
          <FancySelect size="sm" ariaLabel="Estado" value={filtros.estado} onChange={(v) => cambiar({ estado: v || null })} options={op.estado} />
          <FancySelect size="sm" ariaLabel="Tipo" value={filtros.tipo} onChange={(v) => cambiar({ tipo: v || null })} options={op.tipo} />
          {ocultarResponsable ? (
            <span className="hidden lg:block" />
          ) : (
            <SelectorBuscable tam="sm" avatares ariaLabel="Asignado a" value={filtros.responsable_id} onChange={(v) => cambiar({ responsable_id: v || null })} opciones={op.responsable} buscarPlaceholder="Buscar persona o área…" vacio="Nadie coincide" />
          )}
          <FancySelect size="sm" ariaLabel="Prioridad" value={filtros.prioridad} onChange={(v) => cambiar({ prioridad: v || null })} options={op.prioridad} />
          {hayFiltros ? (
            <button
              type="button"
              onClick={() => {
                setTexto("");
                cambiar({ q: null, cliente_id: null, estado: null, tipo: null, responsable_id: null, prioridad: null });
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl px-2.5 text-[12px] font-semibold text-rose-500 hover:bg-rose-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Limpiar
            </button>
          ) : (
            <span className="hidden lg:block" />
          )}
        </div>

        {/* Barra de progreso fina mientras se refresca: no tapa lo que ya se ve. */}
        <div className={`h-0.5 overflow-hidden ${cargando && datos ? "opacity-100" : "opacity-0"} transition-opacity`}>
          <div className="h-full w-1/3 animate-[soporteBarra_1s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-[#4FAEB2] to-transparent" />
        </div>

        {error && !datos ? (
          <div className="p-4"><Aviso>{error}</Aviso></div>
        ) : !datos ? (
          <Cargando filas={6} />
        ) : datos.tickets.length === 0 ? (
          <Vacio
            icono={Inbox}
            titulo={hayFiltros ? "Ningún ticket coincide con los filtros" : soloMios ? "No tenés tickets en esta vista" : "Todavía no hay tickets"}
            detalle={hayFiltros ? "Probá quitando algún filtro." : undefined}
          />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="w-24 px-5 py-3">#</th>
                    <th className="px-3 py-3">Asunto</th>
                    <th className="px-3 py-3">Cliente</th>
                    <th className="px-3 py-3">Tipo</th>
                    <th className="px-3 py-3">Estado</th>
                    <th className="px-3 py-3">Prioridad</th>
                    {ocultarResponsable ? null : <th className="px-3 py-3">Asignado a</th>}
                    <th className="px-5 py-3 text-right">Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.tickets.map((t) => (
                    <tr
                      key={t.id}
                      onMouseEnter={() => precargarTicket(t.id)}
                      onClick={() => router.push(`/dashboard/soporte/tickets/${t.id}`)}
                      className="group relative cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-[#4FAEB2]/[0.04]"
                    >
                      <td className="relative px-5 py-3.5">
                        {/* Filete del color del estado al pasar el mouse. */}
                        <span className="absolute inset-y-2 left-0 w-1 rounded-r-full opacity-0 transition-opacity group-hover:opacity-100" style={{ backgroundColor: t.estado_color }} aria-hidden />
                        <span className="font-bold tabular-nums text-slate-400 group-hover:text-[#2F6E71]">#{t.numero}</span>
                      </td>
                      <td className="max-w-[340px] px-3 py-3.5">
                        <Link
                          href={`/dashboard/soporte/tickets/${t.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="line-clamp-2 font-semibold text-slate-800 no-underline group-hover:text-[#2F6E71]"
                        >
                          {t.asunto}
                        </Link>
                        {t.sla.estado === "vencido" ? (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-600">
                            <AlarmClock className="h-3 w-3" aria-hidden /> SLA vencido
                          </span>
                        ) : t.sla.estado === "en_riesgo" ? (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-600">
                            <AlarmClock className="h-3 w-3" aria-hidden /> SLA en riesgo
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[190px] truncate px-3 py-3.5 font-medium text-slate-600">{t.cliente_nombre ?? "—"}</td>
                      <td className="px-3 py-3.5 text-slate-600">{t.tipo_etiqueta}</td>
                      <td className="px-3 py-3.5">
                        <Insignia color={t.estado_color} punto>{t.estado_nombre}</Insignia>
                      </td>
                      <td className="px-3 py-3.5">
                        <Insignia color={t.prioridad_color} icono={t.prioridad_codigo === "urgente" ? Flame : undefined}>{t.prioridad_nombre}</Insignia>
                      </td>
                      {ocultarResponsable ? null : (
                        <td className="px-3 py-3.5">
                          {t.responsable ? (
                            <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                              <Avatar nombre={t.responsable.nombre} tam={24} />
                              {t.responsable.nombre}
                            </span>
                          ) : (
                            <span className="text-[12px] italic text-slate-400">Sin asignar</span>
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-5 py-3.5 text-right text-[12.5px] tabular-nums text-slate-500">{fechaHora(t.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Móvil */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {datos.tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/dashboard/soporte/tickets/${t.id}`} className="relative block px-4 py-3 no-underline active:bg-slate-50">
                    <span className="absolute inset-y-3 left-0 w-1 rounded-r-full" style={{ backgroundColor: t.estado_color }} aria-hidden />
                    <div className="flex items-center justify-between gap-2 text-[12px] text-slate-500">
                      <span className="font-bold tabular-nums">#{t.numero} · {t.cliente_nombre ?? "Sin cliente"}</span>
                      <span className="tabular-nums">{fechaHora(t.updated_at)}</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{t.asunto}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Insignia color={t.estado_color} punto>{t.estado_nombre}</Insignia>
                      <Insignia color={t.prioridad_color} icono={t.prioridad_codigo === "urgente" ? Flame : undefined}>{t.prioridad_nombre}</Insignia>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Paginación */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-[12px] text-slate-500">
              <span className="tabular-nums">
                Mostrando <b className="text-slate-700">{desde}</b> a <b className="text-slate-700">{hasta}</b> de <b className="text-slate-700">{total}</b> tickets
              </span>
              <div className="flex items-center gap-1">
                <button type="button" disabled={pagina <= 1} onClick={() => cambiar({ pagina: String(pagina - 1) })} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50 disabled:opacity-40" aria-label="Página anterior">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: paginas }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === paginas || Math.abs(n - pagina) <= 1)
                  .map((n, i, arr) => (
                    <span key={n} className="flex items-center gap-1">
                      {i > 0 && n - arr[i - 1] > 1 ? <span className="px-1">…</span> : null}
                      <button
                        type="button"
                        onClick={() => cambiar({ pagina: String(n) })}
                        aria-current={n === pagina ? "page" : undefined}
                        className={`h-8 min-w-8 rounded-lg px-2 font-semibold tabular-nums ${
                          n === pagina ? "bg-[#4FAEB2] text-white shadow-[0_4px_12px_-4px_rgba(79,174,178,0.8)]" : "border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50"
                        }`}
                      >
                        {n}
                      </button>
                    </span>
                  ))}
                <button type="button" disabled={pagina >= paginas} onClick={() => cambiar({ pagina: String(pagina + 1) })} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50 disabled:opacity-40" aria-label="Página siguiente">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
