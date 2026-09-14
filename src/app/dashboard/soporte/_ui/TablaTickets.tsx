"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import SmartCombobox from "@/components/ui/SmartCombobox";
import { apiSoporte, fechaHora, obtenerCatalogos, type CatalogosConEquipo, type Persona } from "./api";
import { Aviso, Cargando, Insignia, Vacio, claseInput } from "./ui";

export type PestanaDef = { id: string; etiqueta: string; estados: readonly string[] | null };

type TicketLista = {
  id: string;
  numero: number;
  asunto: string;
  cliente_nombre: string | null;
  tipo_etiqueta: string;
  estado_nombre: string;
  estado_color: string;
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
};

const POR_PAGINA = 20;

/**
 * Listado de tickets con pestañas, filtros y paginación.
 *
 * El estado vive en la URL (?pestana=…&cliente_id=…): un refresh no pierde los
 * filtros, el botón "atrás" funciona, y otras pantallas pueden enlazar un
 * listado ya filtrado —Clientes lo usa para "ver los tickets de este cliente".
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

  const [cat, setCat] = useState<CatalogosConEquipo | null>(null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [datos, setDatos] = useState<RespLista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState(filtros.q);

  useEffect(() => {
    void obtenerCatalogos().then(setCat).catch((e: Error) => setError(e.message));
    void apiSoporte<{ clientes: { id: string; nombre: string }[] }>("/api/soporte/opciones")
      .then((r) => setClientes(r.clientes))
      .catch(() => {});
  }, []);

  const clave = params.toString();
  useEffect(() => {
    const q = new URLSearchParams();
    if (pestana.estados) q.set("estados", pestana.estados.join(","));
    for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
    if (soloMios) q.set("mios", "1");
    q.set("pagina", String(pagina));
    q.set("por_pagina", String(POR_PAGINA));
    let vivo = true;
    setCargando(true);
    setError(null);
    apiSoporte<RespLista>(`/api/soporte/tickets?${q.toString()}`)
      .then((r) => vivo && setDatos(r))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
    // `clave` resume todos los parámetros de la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, soloMios]);

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

  // Búsqueda con una pausa corta: no se consulta por cada tecla.
  useEffect(() => {
    if (texto === filtros.q) return;
    const t = window.setTimeout(() => cambiar({ q: texto.trim() || null }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const contador = (p: PestanaDef) => {
    const pe = datos?.por_estado ?? {};
    if (!p.estados) return Object.values(pe).reduce((s, n) => s + n, 0);
    return p.estados.reduce((s, e) => s + (pe[e] ?? 0), 0);
  };

  const op = useMemo(() => {
    const todos = (etq: string) => [{ value: "", label: etq }];
    return {
      estado: [...todos("Estado"), ...(cat?.estados ?? []).filter((e) => e.activo).map((e) => ({ value: e.codigo, label: e.nombre }))],
      tipo: [...todos("Tipo"), ...(cat?.tipos ?? []).filter((t) => t.activo).map((t) => ({ value: t.codigo, label: t.nombre }))],
      prioridad: [...todos("Prioridad"), ...(cat?.prioridades ?? []).filter((p) => p.activo).map((p) => ({ value: p.codigo, label: p.nombre }))],
      responsable: [...todos("Asignado a"), ...(cat?.personas ?? []).map((u) => ({ value: u.id, label: u.nombre }))],
    };
  }, [cat]);

  const hayFiltros = Object.values(filtros).some(Boolean);
  const total = datos?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desde = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hasta = Math.min(total, pagina * POR_PAGINA);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Pestañas */}
      <div className="px-4 pt-2">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
          {pestanas.map((p) => {
            const sel = p.id === pestana.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => cambiar({ pestana: p.id === pestanas[0].id ? null : p.id })}
                className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
                  sel ? "border-[#4FAEB2] text-[#2F6E71]" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {p.etiqueta}
                {datos ? (
                  <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${sel ? "bg-[#4FAEB2]/15 text-[#2F6E71]" : "bg-slate-100 text-slate-500"}`}>
                    {contador(p)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtros */}
      <div className="grid gap-2 border-b border-slate-100 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(130px,1fr))_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar tickets…"
            aria-label="Buscar tickets"
            className={`${claseInput} pl-9`}
          />
        </label>
        <SmartCombobox
          options={clientes.map((c) => ({ id: c.id, label: c.nombre }))}
          value={filtros.cliente_id || null}
          onChange={(v) => cambiar({ cliente_id: v })}
          placeholder="Cliente"
        />
        <FancySelect size="sm" ariaLabel="Estado" value={filtros.estado} onChange={(v) => cambiar({ estado: v || null })} options={op.estado} placeholder="Estado" />
        <FancySelect size="sm" ariaLabel="Tipo" value={filtros.tipo} onChange={(v) => cambiar({ tipo: v || null })} options={op.tipo} placeholder="Tipo" />
        {ocultarResponsable ? (
          <span className="hidden lg:block" />
        ) : (
          <FancySelect size="sm" ariaLabel="Asignado a" value={filtros.responsable_id} onChange={(v) => cambiar({ responsable_id: v || null })} options={op.responsable} placeholder="Asignado a" />
        )}
        <FancySelect size="sm" ariaLabel="Prioridad" value={filtros.prioridad} onChange={(v) => cambiar({ prioridad: v || null })} options={op.prioridad} placeholder="Prioridad" />
        {hayFiltros ? (
          <button
            type="button"
            onClick={() => {
              setTexto("");
              cambiar({ q: null, cliente_id: null, estado: null, tipo: null, responsable_id: null, prioridad: null });
            }}
            className="inline-flex items-center justify-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Limpiar
          </button>
        ) : (
          <span className="hidden lg:block" />
        )}
      </div>

      {error ? (
        <div className="p-4">
          <Aviso>{error}</Aviso>
        </div>
      ) : cargando && !datos ? (
        <Cargando />
      ) : (datos?.tickets.length ?? 0) === 0 ? (
        <Vacio
          titulo={hayFiltros ? "Ningún ticket coincide con los filtros" : soloMios ? "No tenés tickets asignados en esta vista" : "Todavía no hay tickets"}
          detalle={hayFiltros ? "Probá quitando algún filtro." : undefined}
        />
      ) : (
        <div className={cargando ? "opacity-60 transition-opacity" : ""}>
          {/* Desktop: tabla */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11.5px] font-medium text-slate-500">
                  <th className="w-20 px-4 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Asunto</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="px-3 py-2.5 font-medium">Prioridad</th>
                  {ocultarResponsable ? null : <th className="px-3 py-2.5 font-medium">Asignado a</th>}
                  <th className="px-4 py-2.5 text-right font-medium">Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {datos?.tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => router.push(`/dashboard/soporte/tickets/${t.id}`)}
                    className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-medium tabular-nums text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        {t.sla.estado === "vencido" ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" title="SLA vencido" aria-label="SLA vencido" />
                        ) : null}
                        #{t.numero}
                      </span>
                    </td>
                    <td className="max-w-[320px] px-3 py-3">
                      <Link
                        href={`/dashboard/soporte/tickets/${t.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="line-clamp-2 font-medium text-slate-900 no-underline hover:text-[#2F6E71]"
                      >
                        {t.asunto}
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3 text-slate-600">{t.cliente_nombre ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-600">{t.tipo_etiqueta}</td>
                    <td className="px-3 py-3">
                      <Insignia color={t.estado_color} punto>{t.estado_nombre}</Insignia>
                    </td>
                    <td className="px-3 py-3">
                      <Insignia color={t.prioridad_color}>{t.prioridad_nombre}</Insignia>
                    </td>
                    {ocultarResponsable ? null : (
                      <td className="px-3 py-3 text-slate-600">{t.responsable?.nombre ?? <span className="text-slate-400">—</span>}</td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-500">{fechaHora(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil: tarjetas compactas */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {datos?.tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/dashboard/soporte/tickets/${t.id}`} className="block px-4 py-3 no-underline active:bg-slate-50">
                  <div className="flex items-center justify-between gap-2 text-[12px] text-slate-500">
                    <span className="tabular-nums">#{t.numero} · {t.cliente_nombre ?? "Sin cliente"}</span>
                    <span className="tabular-nums">{fechaHora(t.updated_at)}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">{t.asunto}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Insignia color={t.estado_color} punto>{t.estado_nombre}</Insignia>
                    <Insignia color={t.prioridad_color}>{t.prioridad_nombre}</Insignia>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Paginación */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-[12px] text-slate-500">
            <span className="tabular-nums">
              Mostrando {desde} a {hasta} de {total} tickets
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={pagina <= 1}
                onClick={() => cambiar({ pagina: String(pagina - 1) })}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Página anterior"
              >
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
                      className={`h-8 min-w-8 rounded-md px-2 tabular-nums ${
                        n === pagina ? "bg-[#4FAEB2] font-semibold text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {n}
                    </button>
                  </span>
                ))}
              <button
                type="button"
                disabled={pagina >= paginas}
                onClick={() => cambiar({ pagina: String(pagina + 1) })}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Página siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
