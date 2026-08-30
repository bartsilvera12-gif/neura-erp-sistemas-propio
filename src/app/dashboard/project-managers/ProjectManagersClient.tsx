"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { leerRespuestaApi } from "@/lib/api/leer-respuesta";
import { coincideBusqueda, tokenizarBusqueda } from "@/lib/proyectos/busqueda";
import { inicialesNombre, nombreCapitular } from "@/lib/format/nombres";
import SpotlightCard from "@/components/reactbits/SpotlightCard";

/**
 * Gestión Project Manager.
 *
 * Lista los usuarios marcados como PM y, al abrir uno, muestra su cartera de
 * clientes y deja agregar o quitar. Un cliente tiene UN PM (columna
 * `clientes.project_manager_id`), así que asignar a alguien que ya lo tenía lo
 * mueve de cartera — por eso el buscador de "agregar" avisa quién lo lleva hoy.
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

const TEAL = "#3F8E91";

function Avatar({ nombre, size = 40 }: { nombre: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-[#4FAEB2]/15 font-bold text-[#2F6E71]"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {inicialesNombre(nombre)}
    </span>
  );
}

export default function ProjectManagersClient() {
  const [datos, setDatos] = useState<Listado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const res = await fetchWithSupabaseSession("/api/project-managers", { cache: "no-store" });
    const r = await leerRespuestaApi<Listado>(res);
    if (!r.ok) setError(r.mensaje);
    else setDatos(r.data);
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const maxCartera = useMemo(
    () => Math.max(1, ...(datos?.project_managers ?? []).map((p) => p.clientes)),
    [datos]
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#2F6E71]">Desarrollo</p>
        <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">Gestión Project Manager</h1>
        <p className="mt-1 text-sm text-slate-500">
          Quién es project manager y qué clientes tiene a cargo. Se marca en el perfil del usuario.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
      ) : null}

      {datos ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Project managers" valor={datos.project_managers.length} />
          <Kpi label="Clientes con PM" valor={datos.total_clientes - datos.sin_asignar} />
          <Kpi label="Sin asignar" valor={datos.sin_asignar} tono={datos.sin_asignar > 0 ? "aviso" : "neutral"} />
          <Kpi label="Clientes totales" valor={datos.total_clientes} />
        </div>
      ) : null}

      {cargando && !datos ? (
        <p className="px-1 py-6 text-sm text-slate-400">Cargando…</p>
      ) : datos && datos.project_managers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">Todavía no hay project managers</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Se marcan desde <strong>Usuarios</strong>, con la casilla “Es project manager” en el perfil de la
            persona. Después vuelven a aparecer acá para cargarles su cartera.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {(datos?.project_managers ?? []).map((pm) => (
            <li key={pm.id}>
              <SpotlightCard
                spotlightColor="rgba(79, 174, 178, 0.10)"
                className="rounded-2xl border border-slate-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() => setAbierto(pm.id)}
                  className="flex w-full items-center gap-3 p-3 text-left"
                >
                  <Avatar nombre={pm.nombre} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {nombreCapitular(pm.nombre)}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {pm.email ?? "—"}
                      {pm.area ? ` · ${pm.area}` : ""}
                    </span>
                  </span>
                  <span className="hidden w-40 shrink-0 sm:block">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(3, Math.round((pm.clientes / maxCartera) * 100))}%`,
                          background: TEAL,
                        }}
                      />
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-base font-bold tabular-nums text-slate-900">{pm.clientes}</span>
                    <span className="block text-[10px] uppercase tracking-wide text-slate-400">
                      {pm.clientes === 1 ? "cliente" : "clientes"}
                    </span>
                  </span>
                  <span aria-hidden="true" className="shrink-0 pl-1 text-slate-300">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              </SpotlightCard>
            </li>
          ))}
        </ul>
      )}

      {datos && datos.asignados_a_no_pm > 0 ? (
        <p className="text-[11px] text-slate-400">
          Hay {datos.asignados_a_no_pm} cliente(s) asignados a alguien que ya no está marcado como project
          manager. Marcalo de nuevo en Usuarios o movelos a otra cartera.
        </p>
      ) : null}

      {abierto ? (
        <CarteraModal
          pmId={abierto}
          onClose={() => setAbierto(null)}
          onCambio={() => void cargar()}
        />
      ) : null}
    </div>
  );
}

function Kpi({ label, valor, tono = "neutral" }: { label: string; valor: number; tono?: "neutral" | "aviso" }) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        tono === "aviso" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${tono === "aviso" ? "text-amber-700" : "text-slate-900"}`}>
        {valor}
      </p>
    </div>
  );
}

function CarteraModal({
  pmId,
  onClose,
  onCambio,
}: {
  pmId: string;
  onClose: () => void;
  onCambio: () => void;
}) {
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
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

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onClose]);

  const cambiar = useCallback(
    async (cuerpo: { asignar?: string[]; quitar?: string[] }) => {
      setGuardando(true);
      const res = await fetchWithSupabaseSession(`/api/project-managers/${pmId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const r = await leerRespuestaApi(res);
      setGuardando(false);
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
  const disponiblesFiltrados = useMemo(() => {
    const base = detalle?.disponibles ?? [];
    if (tokens.length === 0) return base.slice(0, 40);
    return base
      .filter((c) => coincideBusqueda(tokens, `${c.label} ${c.contacto} ${c.telefono}`))
      .slice(0, 40);
  }, [detalle, tokens]);

  const puedeEditar = detalle?.puede_editar === true;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-none border-slate-200 bg-white shadow-2xl ring-1 ring-[#4FAEB2]/15 sm:h-[86dvh] sm:rounded-2xl sm:border"
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40" />

        <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <Avatar nombre={detalle?.project_manager.nombre ?? "?"} size={38} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-slate-900">
              {detalle ? nombreCapitular(detalle.project_manager.nombre) : "Cargando…"}
            </h2>
            <p className="truncate text-xs text-slate-400">
              {detalle?.asignados.length ?? 0} cliente(s) a cargo
              {detalle?.project_manager.email ? ` · ${detalle.project_manager.email}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            Cerrar
          </button>
        </header>

        {error ? (
          <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Clientes a cargo</h3>
            {puedeEditar ? (
              <button
                type="button"
                onClick={() => setAgregando((v) => !v)}
                className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-2.5 py-1 text-xs font-semibold text-[#2F6E71] transition-colors hover:bg-[#4FAEB2]/20"
              >
                {agregando ? "Listo" : "+ Agregar clientes"}
              </button>
            ) : null}
          </div>

          {agregando && puedeEditar ? (
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
              <input
                autoFocus
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar cliente por nombre, contacto o teléfono…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/25"
              />
              <ul className="mt-2 max-h-64 overflow-y-auto">
                {disponiblesFiltrados.length === 0 ? (
                  <li className="px-1 py-3 text-xs text-slate-400">Sin resultados.</li>
                ) : (
                  disponiblesFiltrados.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={guardando}
                        onClick={() => void cambiar({ asignar: [c.id] })}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-800">{c.label}</span>
                          {c.ocupado_por ? (
                            <span className="block truncate text-[11px] text-amber-700">
                              Hoy lo lleva {c.ocupado_por_nombre ? nombreCapitular(c.ocupado_por_nombre) : "otro PM"}
                              {" · se va a mover a esta cartera"}
                            </span>
                          ) : c.contacto ? (
                            <span className="block truncate text-[11px] text-slate-400">{c.contacto}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-[#2F6E71]">Agregar</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {(detalle?.disponibles.length ?? 0) > disponiblesFiltrados.length ? (
                <p className="px-1 pt-1.5 text-[10px] text-slate-400">
                  Mostrando {disponiblesFiltrados.length} de {detalle?.disponibles.length}. Escribí para acotar.
                </p>
              ) : null}
            </div>
          ) : null}

          {!detalle ? (
            <p className="py-6 text-sm text-slate-400">Cargando…</p>
          ) : detalle.asignados.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <p className="text-sm font-medium text-slate-700">Todavía no tiene clientes asignados</p>
              <p className="mt-1 text-xs text-slate-500">
                {puedeEditar
                  ? "Usá “Agregar clientes” para armar su cartera."
                  : "Solo un administrador o el propio project manager puede cargarlos."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {detalle.asignados.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{c.label}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {[c.contacto, c.telefono, c.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                    </span>
                  </span>
                  {puedeEditar ? (
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => void cambiar({ quitar: [c.id] })}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
