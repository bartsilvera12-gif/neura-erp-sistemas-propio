"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, UserRoundPlus, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { leerRespuestaApi } from "@/lib/api/leer-respuesta";
import { coincideBusqueda, tokenizarBusqueda } from "@/lib/proyectos/busqueda";
import { inicialesNombre, nombreCapitular } from "@/lib/format/nombres";
import CountUp from "@/components/reactbits/CountUp";
import SpotlightCard from "@/components/reactbits/SpotlightCard";

/**
 * Gestión Project Manager.
 *
 * Layout maestro-detalle y no lista + modal: la pantalla se usa para REPARTIR
 * una cartera, así que hay que ver a quién le falta y qué clientes están
 * sueltos al mismo tiempo. Con un modal, cada asignación era abrir, buscar,
 * cerrar, y el resto de la pantalla quedaba vacío.
 *
 * Un cliente tiene UN PM (`clientes.project_manager_id`): asignar a alguien que
 * ya lo tenía lo MUEVE de cartera, por eso el buscador avisa quién lo lleva hoy.
 */

type PmRow = { id: string; nombre: string; email: string | null; area: string | null; clientes: number };
type Listado = {
  project_managers: PmRow[];
  total_clientes: number;
  sin_asignar: number;
  asignados_a_no_pm: number;
};
type ClienteRow = {
  id: string;
  label: string;
  contacto: string;
  telefono: string;
  email: string;
  estado: string | null;
  ocupado_por: string | null;
  ocupado_por_nombre?: string | null;
};
type Detalle = {
  project_manager: { id: string; nombre: string; email: string | null; area: string | null };
  asignados: ClienteRow[];
  disponibles: ClienteRow[];
  puede_editar: boolean;
};

/**
 * Un solo hue para la magnitud (cartera), en su paso oscuro: es una serie
 * única, no una paleta categórica. El ámbar es estado ("falta asignar"), va
 * siempre con icono y texto — nunca color solo.
 */
const TEAL = "#2F6E71";
const TEAL_CLARO = "#4FAEB2";

function Avatar({ nombre, size = 40 }: { nombre: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-[#4FAEB2]/15 font-bold text-[#2F6E71]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {inicialesNombre(nombre)}
    </span>
  );
}

/** Barra de magnitud: fina, un solo hue, extremos redondeados. */
function Barra({ pct, tono = TEAL }: { pct: number; tono?: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <span
        className="block h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(pct > 0 ? 3 : 0, Math.round(pct))}%`, background: tono }}
      />
    </span>
  );
}

export default function ProjectManagersClient() {
  const [datos, setDatos] = useState<Listado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    const res = await fetchWithSupabaseSession("/api/project-managers", { cache: "no-store" });
    const r = await leerRespuestaApi<Listado>(res);
    if (!r.ok) setError(r.mensaje);
    else {
      setDatos(r.data);
      // Al entrar se abre el primero: la pantalla nace mostrando una cartera,
      // no un panel vacío esperando un clic.
      setSeleccionado((prev) => prev ?? r.data.project_managers[0]?.id ?? null);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const pms = datos?.project_managers ?? [];
  const total = datos?.total_clientes ?? 0;
  const conPm = total - (datos?.sin_asignar ?? 0);
  const cobertura = total > 0 ? Math.round((conPm / total) * 100) : 0;
  const maxCartera = useMemo(() => Math.max(1, ...pms.map((p) => p.clientes)), [pms]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#2F6E71]">Desarrollo</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Gestión Project Manager</h1>
          <p className="mt-1 text-sm text-slate-500">
            Quién es project manager y qué clientes tiene a cargo. Se marca en el perfil del usuario.
          </p>
        </div>
      </header>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Cobertura de la cartera: el dato que resume la pantalla. */}
      <SpotlightCard
        spotlightColor="rgba(79, 174, 178, 0.12)"
        className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5"
      >
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div className="min-w-[180px]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
              Cobertura de cartera
            </p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tabular-nums tracking-tight text-slate-900">
                <CountUp key={cobertura} to={cobertura} duration={0.9} />%
              </span>
              <span className="text-sm text-slate-400">
                {conPm} de {total} clientes
              </span>
            </p>
            <span className="mt-2 block max-w-[260px]">
              <Barra pct={cobertura} />
            </span>
          </div>

          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <Dato label="Project managers" valor={pms.length} />
            <Dato label="Con project manager" valor={conPm} />
            <Dato
              label="Sin asignar"
              valor={datos?.sin_asignar ?? 0}
              alerta={(datos?.sin_asignar ?? 0) > 0}
            />
          </dl>
        </div>

        {datos && datos.asignados_a_no_pm > 0 ? (
          <p className="mt-3 flex items-start gap-1.5 border-t border-slate-100 pt-3 text-[11px] text-amber-700">
            <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {datos.asignados_a_no_pm} cliente(s) siguen asignados a alguien que ya no está marcado como
              project manager. Volvé a marcarlo en Usuarios o movelos a otra cartera.
            </span>
          </p>
        ) : null}
      </SpotlightCard>

      {cargando && !datos ? (
        <p className="px-1 py-10 text-center text-sm text-slate-400">Cargando…</p>
      ) : pms.length === 0 ? (
        <SinProjectManagers />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <nav aria-label="Project managers" className="space-y-2">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Project managers
            </h2>
            <ul className="space-y-1.5">
              {pms.map((pm) => {
                const activo = pm.id === seleccionado;
                return (
                  <li key={pm.id}>
                    <button
                      type="button"
                      aria-current={activo ? "true" : undefined}
                      onClick={() => setSeleccionado(pm.id)}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        activo
                          ? "border-[#4FAEB2]/50 bg-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]/25"
                          : "border-slate-200 bg-white hover:border-[#4FAEB2]/40 hover:bg-slate-50/60"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Avatar nombre={pm.nombre} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            {nombreCapitular(pm.nombre)}
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">{pm.email ?? "—"}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-lg font-bold leading-none tabular-nums text-slate-900">
                            {pm.clientes}
                          </span>
                        </span>
                      </span>
                      <span className="mt-2 block">
                        <Barra pct={(pm.clientes / maxCartera) * 100} tono={activo ? TEAL : TEAL_CLARO} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {seleccionado ? (
            <Cartera key={seleccionado} pmId={seleccionado} onCambio={() => void cargar()} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function Dato({ label, valor, alerta = false }: { label: string; valor: number; alerta?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-2xl font-bold tabular-nums text-slate-900">
        {alerta ? <AlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-500" /> : null}
        {valor}
      </dd>
    </div>
  );
}

function SinProjectManagers() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <span
        aria-hidden="true"
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#4FAEB2]/12 text-[#2F6E71]"
      >
        <UserRoundPlus className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-semibold text-slate-800">Todavía no hay project managers</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
        Se marcan desde <strong className="font-semibold text-slate-700">Usuarios</strong>, con la casilla
        “Es project manager” en el perfil de la persona. Después aparecen acá para cargarles su cartera.
      </p>
    </div>
  );
}

function Cartera({ pmId, onCambio }: { pmId: string; onCambio: () => void }) {
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [agregando, setAgregando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetchWithSupabaseSession(`/api/project-managers/${pmId}`, { cache: "no-store" });
    const r = await leerRespuestaApi<Detalle>(res);
    if (!r.ok) setError(r.mensaje);
    else {
      setDetalle(r.data);
      setError(null);
    }
  }, [pmId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cambiar = useCallback(
    async (clienteId: string, cuerpo: { asignar?: string[]; quitar?: string[] }) => {
      setGuardando(clienteId);
      const res = await fetchWithSupabaseSession(`/api/project-managers/${pmId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const r = await leerRespuestaApi(res);
      setGuardando(null);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setError(null);
      await cargar();
      onCambio();
    },
    [pmId, cargar, onCambio]
  );

  const tokens = useMemo(() => tokenizarBusqueda(busqueda), [busqueda]);
  const disponibles = detalle?.disponibles ?? [];
  const filtrados = useMemo(() => {
    if (tokens.length === 0) return disponibles.slice(0, 50);
    return disponibles
      .filter((c) => coincideBusqueda(tokens, `${c.label} ${c.contacto} ${c.telefono}`))
      .slice(0, 50);
  }, [disponibles, tokens]);

  const puedeEditar = detalle?.puede_editar === true;
  const asignados = detalle?.asignados ?? [];

  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <Avatar nombre={detalle?.project_manager.nombre ?? "?"} size={42} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-slate-900">
            {detalle ? nombreCapitular(detalle.project_manager.nombre) : "Cargando…"}
          </h2>
          <p className="truncate text-xs text-slate-400">
            {asignados.length} {asignados.length === 1 ? "cliente a cargo" : "clientes a cargo"}
            {detalle?.project_manager.email ? ` · ${detalle.project_manager.email}` : ""}
          </p>
        </div>
        {puedeEditar ? (
          <button
            type="button"
            onClick={() => setAgregando((v) => !v)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              agregando
                ? "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                : "bg-[#2F6E71] text-white hover:bg-[#255A5C]"
            }`}
          >
            {agregando ? <X className="h-3.5 w-3.5" /> : <UserRoundPlus className="h-3.5 w-3.5" />}
            {agregando ? "Cerrar" : "Agregar clientes"}
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {agregando && puedeEditar ? (
        <div className="border-b border-slate-100 bg-slate-50/60 p-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]"
            />
            <input
              autoFocus
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setBusqueda("")}
              placeholder="Buscar cliente por nombre, contacto o teléfono…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
            />
          </div>
          <ul className="mt-2 max-h-[320px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
            {filtrados.length === 0 ? (
              <li className="px-3 py-4 text-xs text-slate-400">Sin resultados para “{busqueda}”.</li>
            ) : (
              filtrados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={guardando != null}
                    onClick={() => void cambiar(c.id, { asignar: [c.id] })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#4FAEB2]/8 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800">{c.label}</span>
                      {c.ocupado_por ? (
                        <span className="flex items-center gap-1 truncate text-[11px] text-amber-700">
                          <AlertTriangle aria-hidden="true" className="h-3 w-3 shrink-0" />
                          Hoy lo lleva{" "}
                          {c.ocupado_por_nombre ? nombreCapitular(c.ocupado_por_nombre) : "otro PM"} · se va a
                          mover
                        </span>
                      ) : c.contacto || c.telefono ? (
                        <span className="block truncate text-[11px] text-slate-400">
                          {[c.contacto, c.telefono].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-[#2F6E71]">
                      {guardando === c.id ? "Agregando…" : "Agregar"}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          {disponibles.length > filtrados.length ? (
            <p className="px-1 pt-1.5 text-[10px] text-slate-400">
              Mostrando {filtrados.length} de {disponibles.length} clientes. Escribí para acotar.
            </p>
          ) : null}
        </div>
      ) : null}

      {!detalle ? (
        <p className="p-8 text-sm text-slate-400">Cargando…</p>
      ) : asignados.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm font-semibold text-slate-800">Todavía no tiene clientes asignados</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
            {puedeEditar
              ? "Usá “Agregar clientes” para armar su cartera; podés buscar por nombre, contacto o teléfono."
              : "Solo un administrador o el propio project manager puede cargarlos."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Cliente
                </th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Contacto
                </th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {puedeEditar ? "Acción" : ""}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {asignados.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium text-slate-800">{c.label}</span>
                    {c.contacto && c.contacto !== c.label ? (
                      <span className="block text-[11px] text-slate-400">{c.contacto}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-500">
                    {[c.telefono, c.email].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {puedeEditar ? (
                      <button
                        type="button"
                        disabled={guardando != null}
                        onClick={() => void cambiar(c.id, { quitar: [c.id] })}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      >
                        {guardando === c.id ? "Quitando…" : "Quitar"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
