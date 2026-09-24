"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Ticket } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { FechaSelect } from "@/components/ui/FechaSelect";

interface SubEstado {
  id: string | null;
  nombre: string;
  comportamiento: string | null;
  total: number;
  con_ticket: number;
}
interface Estado {
  id: string | null;
  nombre: string;
  total: number;
  con_ticket: number;
  subestados: SubEstado[];
}
interface Usuario {
  id: string | null;
  nombre: string;
  total: number;
}
interface Hora {
  hora: number;
  total: number;
  con_ticket: number;
}
interface Data {
  desde: string | null;
  hasta: string | null;
  total: number;
  con_ticket: number;
  estados: Estado[];
  usuarios: Usuario[];
  horas: Hora[];
}
interface Cliente {
  id: string;
  nombre: string;
}

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Paleta estable por Estado (según su nombre): que Solicitud/Reclamo/Consulta
// siempre lleven el mismo color aunque cambie el orden.
const TONOS = [
  { bar: "bg-sky-500", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  { bar: "bg-amber-500", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  { bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { bar: "bg-violet-500", chip: "bg-violet-50 text-violet-700 border-violet-200" },
  { bar: "bg-rose-500", chip: "bg-rose-50 text-rose-700 border-rose-200" },
  { bar: "bg-teal-500", chip: "bg-teal-50 text-teal-700 border-teal-200" },
];
function tonoDe(nombre: string) {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return TONOS[h % TONOS.length];
}

export default function ReporteTipificacionesPage() {
  const [desde, setDesde] = useState(firstOfMonth());
  const [hasta, setHasta] = useState(today());
  const [clienteId, setClienteId] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuariosOpts, setUsuariosOpts] = useState<Usuario[]>([]);

  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (clienteId) p.set("cliente_id", clienteId);
    if (usuarioId) p.set("usuario_id", usuarioId);
    return p.toString();
  }, [desde, hasta, clienteId, usuarioId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/reportes/tipificaciones?${qs}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        setData(null);
        return;
      }
      const d = j.data as Data;
      setData(d);
      // El desplegable de usuario se llena con la lista completa (cuando no se
      // está filtrando por usuario, la respuesta trae a todos).
      if (!usuarioId && d.usuarios.length) setUsuariosOpts(d.usuarios);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [qs, usuarioId]);

  useEffect(() => {
    apiFetch("/api/clientes")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        const list = (j?.data?.clientes ?? j?.data ?? []) as { id: string; nombre?: string; razon_social?: string; empresa?: string }[];
        setClientes(list.map((c) => ({ id: c.id, nombre: c.razon_social || c.nombre || c.empresa || "—" })));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = (key: string) =>
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const maxEstado = data?.estados.reduce((m, e) => Math.max(m, e.total), 0) || 1;
  const maxUsuario = data?.usuarios.reduce((m, u) => Math.max(m, u.total), 0) || 1;
  const maxHora = data?.horas?.reduce((m, h) => Math.max(m, h.total), 0) || 1;
  const horaPico = data?.horas?.reduce<Hora | null>((best, h) => (best && best.total >= h.total ? best : h.total > 0 ? h : best), null) ?? null;

  return (
    <div className="w-full min-w-0 space-y-5">
      <div>
        <nav className="mb-1 text-xs text-slate-500">
          <Link href="/reportes" className="hover:text-[#4FAEB2]">
            Reportes
          </Link>{" "}
          / <span className="font-semibold text-slate-700">Tipificaciones</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tipificaciones</h1>
        <p className="mt-1 text-sm text-slate-500">
          Volumen de tipificaciones por Estado (Solicitud / Reclamo / Consulta…) con su desglose en sub-estados y ranking por usuario. Marca cuántas generaron un ticket de Soporte.
        </p>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
        <label className="text-xs font-semibold text-slate-500">
          Desde
          <FechaSelect value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Hasta
          <FechaSelect value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Cliente
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Usuario
          <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {usuariosOpts
              .filter((u) => u.id)
              .map((u) => (
                <option key={u.id} value={u.id!}>
                  {u.nombre}
                </option>
              ))}
          </select>
        </label>
        <div className="flex items-end">
          <button onClick={load} className="w-full rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">
            Aplicar
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Totales */}
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-400">Tipificaciones</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{data.total}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-400">Estados</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{data.estados.length}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <p className="text-xs text-emerald-600">Con ticket</p>
            <p className="text-lg font-bold tabular-nums text-emerald-700">{data.con_ticket}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-400">Usuarios</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{data.usuarios.length}</p>
          </div>
        </div>
      )}

      {/* Distribución por hora del día */}
      {data && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Por hora del día</h2>
            {horaPico && (
              <span className="text-xs text-slate-500">
                Pico: <span className="font-semibold text-slate-700">{String(horaPico.hora).padStart(2, "0")}:00–{String(horaPico.hora).padStart(2, "0")}:59</span> ({horaPico.total})
              </span>
            )}
          </div>
          {data.total === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Sin datos en el período/filtros.</p>
          ) : (
            <>
              <div className="flex items-end gap-1" style={{ height: 140 }}>
                {data.horas.map((h) => {
                  const altura = Math.round((h.total / maxHora) * 120);
                  const alturaTk = h.total > 0 ? Math.round((h.con_ticket / maxHora) * 120) : 0;
                  return (
                    <div key={h.hora} className="group relative flex flex-1 flex-col items-center justify-end" style={{ height: 120 }} title={`${String(h.hora).padStart(2, "0")}:00 — ${h.total} tipif.${h.con_ticket ? ` · ${h.con_ticket} con ticket` : ""}`}>
                      {h.total > 0 && <span className="mb-0.5 text-[9px] font-semibold tabular-nums text-slate-400 opacity-0 group-hover:opacity-100">{h.total}</span>}
                      <div className="flex w-full max-w-[18px] flex-col justify-end overflow-hidden rounded-t bg-slate-100" style={{ height: Math.max(h.total > 0 ? 4 : 0, altura) }}>
                        {alturaTk > 0 && <div className="w-full bg-emerald-400" style={{ height: alturaTk }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex gap-1">
                {data.horas.map((h) => (
                  <div key={h.hora} className="flex-1 text-center text-[8px] tabular-nums text-slate-400">
                    {h.hora % 3 === 0 ? String(h.hora).padStart(2, "0") : ""}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-200" /> Tipificaciones</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Con ticket</span>
                <span className="ml-auto">Hora de Paraguay</span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Estados con drill-down */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Por estado</h2>
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
          ) : !data || data.estados.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Sin tipificaciones en el período/filtros.</p>
          ) : (
            <ul className="space-y-2">
              {data.estados.map((e, i) => {
                const key = e.id ?? `txt:${e.nombre}:${i}`;
                const abierto = abiertos.has(key);
                const tono = tonoDe(e.nombre);
                const pct = Math.round((e.total / data.total) * 100);
                return (
                  <li key={key} className="rounded-xl border border-slate-100">
                    <button onClick={() => toggle(key)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50/70">
                      <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-90" : ""}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-800">{e.nombre}</span>
                          <span className="shrink-0 text-xs text-slate-400">{pct}%</span>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${tono.bar}`} style={{ width: `${Math.max(3, Math.round((e.total / maxEstado) * 100))}%` }} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-base font-bold tabular-nums text-slate-800">{e.total}</p>
                        {e.con_ticket > 0 && (
                          <p className="flex items-center justify-end gap-0.5 text-[11px] text-emerald-600">
                            <Ticket className="h-3 w-3" />
                            {e.con_ticket}
                          </p>
                        )}
                      </div>
                    </button>
                    {abierto && (
                      <ul className="border-t border-slate-100 bg-slate-50/50 px-3 py-2">
                        {e.subestados.map((s, j) => (
                          <li key={s.id ?? `txt:${s.nombre}:${j}`} className="flex items-center gap-2 py-1.5 pl-6 text-sm">
                            <span className="min-w-0 flex-1 break-words text-slate-600">{s.nombre}</span>
                            {(s.comportamiento === "ticket_error" || s.comportamiento === "ticket_cambio") && (
                              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${s.comportamiento === "ticket_error" ? "border-rose-200 bg-rose-50 text-rose-600" : "border-indigo-200 bg-indigo-50 text-indigo-600"}`}>
                                {s.comportamiento === "ticket_error" ? "Error" : "Cambio"}
                              </span>
                            )}
                            {s.comportamiento === "capacitacion" && (
                              <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">Capacitación</span>
                            )}
                            {s.con_ticket > 0 && (
                              <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-emerald-600">
                                <Ticket className="h-3 w-3" />
                                {s.con_ticket}
                              </span>
                            )}
                            <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-slate-700">{s.total}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Ranking por usuario */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Por usuario</h2>
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
          ) : !data || data.usuarios.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Sin datos.</p>
          ) : (
            <ul className="space-y-2">
              {data.usuarios.map((u, i) => (
                <li key={u.id ?? `txt:${u.nombre}:${i}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-slate-700">{u.nombre}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{u.total}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#4FAEB2]" style={{ width: `${Math.max(3, Math.round((u.total / maxUsuario) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
