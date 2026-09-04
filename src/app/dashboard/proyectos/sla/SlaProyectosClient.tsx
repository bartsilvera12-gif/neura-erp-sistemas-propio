"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertOctagon, AlertTriangle, Database, PauseCircle } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { Kpi } from "@/components/ui/report";

const TEAL = "#4FAEB2";
const COLOR_ALDIA = "#10b981";
const COLOR_RIESGO = "#f59e0b";
const COLOR_VENCIDO = "#f43f5e";

type Semaforo = "al_dia" | "en_riesgo" | "vencido";

type SlaData = {
  fecha_ref: string;
  dias_riesgo: number;
  monitoreados: number;
  cumplimiento_pct: number;
  vencidos: number;
  en_riesgo: number;
  al_dia: number;
  pausados: number;
  tiempo_respuesta_ms: number | null;
  tiempo_resolucion_ms: number | null;
  por_estado: { estado_id: string; nombre: string; color: string; cantidad: number }[];
  por_tecnico: { usuario_id: string; nombre: string; total: number; cumplimiento_pct: number }[];
  tendencia: { fecha: string; cumplimiento_pct: number }[];
  criticos: {
    id: string;
    titulo: string;
    cliente: string;
    estado_nombre: string;
    estado_color: string;
    responsable_tecnico: string;
    fecha_prometida: string | null;
    dias_restantes: number | null;
    semaforo: Semaforo;
  }[];
};

type Opcion = { id: string; nombre: string };

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const labelCls = "block text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1";

/** Duración en horas laborales -> "Xd Yh" (jornadas de 9 h) / "Xh Ym" / "Ym". */
function fmtDur(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalMin = Math.round(ms / 60000);
  const jornMin = 9 * 60;
  if (totalMin >= jornMin) {
    const d = Math.floor(totalMin / jornMin);
    const h = Math.round((totalMin - d * jornMin) / 60);
    return `${d}d ${h}h`;
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDiaCorto(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y ? `${d}/${m}` : iso;
}

const SEMAFORO_META: Record<Semaforo, { label: string; color: string; badge: string }> = {
  al_dia: { label: "Al día", color: COLOR_ALDIA, badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  en_riesgo: { label: "En riesgo", color: COLOR_RIESGO, badge: "bg-amber-50 text-amber-700 border-amber-200" },
  vencido: { label: "Vencido", color: COLOR_VENCIDO, badge: "bg-rose-50 text-rose-700 border-rose-200" },
};

function slaDiasLabel(dias: number | null): string {
  if (dias == null) return "—";
  if (dias < 0) return `${Math.abs(dias)}d vencido`;
  if (dias === 0) return "Hoy";
  return `${dias}d`;
}

export default function SlaProyectosClient() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fRc, setFRc] = useState("");
  const [fRt, setFRt] = useState("");

  const [estados, setEstados] = useState<Opcion[]>([]);
  const [tipos, setTipos] = useState<Opcion[]>([]);
  const [usuarios, setUsuarios] = useState<Opcion[]>([]);

  const [data, setData] = useState<SlaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Opciones de filtro (una sola vez).
  useEffect(() => {
    let cancel = false;
    (async () => {
      const [rEst, rTip, rUsers] = await Promise.all([
        fetchWithSupabaseSession("/api/proyectos/estados", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/proyectos/tipos", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/usuarios/empresa-activos", { cache: "no-store" }),
      ]);
      const jEst = (await rEst.json().catch(() => ({}))) as { data?: Opcion[] };
      const jTip = (await rTip.json().catch(() => ({}))) as { data?: Opcion[] };
      const jUsers = (await rUsers.json().catch(() => ({}))) as {
        usuarios?: { id: string; nombre?: string | null; email?: string | null }[];
      };
      if (cancel) return;
      setEstados(jEst.data ?? []);
      setTipos(jTip.data ?? []);
      setUsuarios(
        (jUsers.usuarios ?? []).map((u) => ({ id: u.id, nombre: (u.nombre ?? "").trim() || u.email || "—" }))
      );
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams();
    if (fecha) sp.set("fecha", fecha);
    if (fEstado) sp.set("estado_id", fEstado);
    if (fTipo) sp.set("tipo_id", fTipo);
    if (fRc) sp.set("responsable_comercial_id", fRc);
    if (fRt) sp.set("responsable_tecnico_id", fRt);
    const res = await fetchWithSupabaseSession(`/api/proyectos/sla-dashboard?${sp.toString()}`, {
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { success?: boolean; data?: SlaData; error?: string };
    if (!res.ok || !j.success || !j.data) {
      setErr(j.error ?? "No se pudo cargar el dashboard");
      setLoading(false);
      return;
    }
    setData(j.data);
    setLoading(false);
  }, [fecha, fEstado, fTipo, fRc, fRt]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const donut = useMemo(() => {
    if (!data) return [];
    return [
      { key: "al_dia", label: "Al día", value: data.al_dia, color: COLOR_ALDIA },
      { key: "en_riesgo", label: "En riesgo", value: data.en_riesgo, color: COLOR_RIESGO },
      { key: "vencido", label: "Vencidos", value: data.vencidos, color: COLOR_VENCIDO },
    ].filter((s) => s.value > 0);
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#4FAEB2]" />
            <h1 className="text-xl font-bold text-slate-800">Dashboard SLA</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">Resumen del cumplimiento de SLA de proyectos.</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm">
          <Database className="h-3.5 w-3.5 text-[#4FAEB2]" />
          Fuente de datos: <span className="font-semibold text-slate-700">Módulo Proyectos</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className={labelCls}>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Estado</label>
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {estados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Tipo</label>
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Resp. comercial</label>
          <select value={fRc} onChange={(e) => setFRc(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Resp. técnico</label>
          <select value={fRt} onChange={(e) => setFRt(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{err}</div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Cargando…
        </div>
      ) : data ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Proyectos monitoreados" value={String(data.monitoreados)} accent />
            <Kpi
              label="% cumplimiento SLA"
              value={`${data.cumplimiento_pct}%`}
              subColor={data.cumplimiento_pct >= 90 ? "text-emerald-600" : data.cumplimiento_pct >= 75 ? "text-amber-600" : "text-rose-600"}
              sub={data.cumplimiento_pct >= 90 ? "Objetivo cumplido" : "Bajo objetivo (90%)"}
            />
            <Kpi label="Vencidos" value={String(data.vencidos)} subColor="text-rose-600" sub="Atención inmediata" />
            <Kpi label="En riesgo" value={String(data.en_riesgo)} subColor="text-amber-600" sub={`Vence en ≤ ${data.dias_riesgo}d`} />
            <Kpi label="Tiempo prom. respuesta" value={fmtDur(data.tiempo_respuesta_ms)} sub="Hasta el 1er movimiento" />
            <Kpi label="Tiempo prom. resolución" value={fmtDur(data.tiempo_resolucion_ms)} sub="Ingreso → 1ª entrega" />
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Semáforo SLA (donut) */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Semáforo SLA</h2>
              {donut.length === 0 ? (
                <p className="text-sm text-slate-400">Sin datos</p>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <div className="relative h-[190px] w-[190px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donut}
                          dataKey="value"
                          nameKey="label"
                          innerRadius={62}
                          outerRadius={88}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {donut.map((s) => (
                            <Cell key={s.key} fill={s.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number, n) => [`${v} proyectos`, String(n)]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-slate-800">{data.cumplimiento_pct}%</span>
                      <span className="text-[11px] text-slate-400">cumplimiento</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    {donut.map((s) => (
                      <div key={s.key} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-slate-600">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="font-semibold text-slate-700">
                          {s.value}{" "}
                          <span className="text-xs font-normal text-slate-400">
                            ({data.monitoreados > 0 ? Math.round((s.value / data.monitoreados) * 100) : 0}%)
                          </span>
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-slate-100 pt-2 text-xs text-slate-400">
                      Total: {data.monitoreados} proyectos
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Cumplimiento por responsable técnico */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Cumplimiento por responsable técnico</h2>
              {data.por_tecnico.length === 0 ? (
                <p className="text-sm text-slate-400">Sin datos</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, data.por_tecnico.length * 34)}>
                  <BarChart data={data.por_tecnico} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid horizontal={false} stroke="#eef2f5" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="nombre" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [`${v}%`, "Cumplimiento"]} />
                    <ReferenceLine x={90} stroke="#cbd5e1" strokeDasharray="4 4" />
                    <Bar dataKey="cumplimiento_pct" radius={[0, 4, 4, 0]} barSize={16}>
                      {data.por_tecnico.map((t) => (
                        <Cell
                          key={t.usuario_id}
                          fill={t.cumplimiento_pct >= 90 ? COLOR_ALDIA : t.cumplimiento_pct >= 75 ? COLOR_RIESGO : COLOR_VENCIDO}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Proyectos por estado */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Proyectos por estado</h2>
              {data.por_estado.length === 0 ? (
                <p className="text-sm text-slate-400">Sin datos</p>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={data.por_estado} margin={{ top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f5" />
                    <XAxis
                      dataKey="nombre"
                      tick={{ fontSize: 10 }}
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis allowDecimals={false} width={30} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => [`${v} proyectos`, "Cantidad"]} />
                    <Bar dataKey="cantidad" radius={[4, 4, 0, 0]}>
                      {data.por_estado.map((e) => (
                        <Cell key={e.estado_id} fill={e.color || TEAL} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Tendencia de cumplimiento */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Tendencia de cumplimiento (últimos 7 días)</h2>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={data.tendencia} margin={{ top: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f5" />
                  <XAxis dataKey="fecha" tickFormatter={fmtDiaCorto} tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} width={34} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(v: number) => [`${v}%`, "Cumplimiento"]}
                    labelFormatter={(l) => fmtDiaCorto(String(l))}
                  />
                  <ReferenceLine y={90} stroke="#cbd5e1" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="cumplimiento_pct" stroke={TEAL} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Paneles inferiores */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Críticos */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Proyectos críticos / próximos vencimientos</h2>
              </div>
              {data.criticos.length === 0 ? (
                <p className="text-sm text-slate-400">No hay proyectos críticos en este momento.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="pb-2 font-medium">Proyecto</th>
                        <th className="pb-2 font-medium">Cliente</th>
                        <th className="pb-2 font-medium">Estado</th>
                        <th className="pb-2 font-medium">Resp. técnico</th>
                        <th className="pb-2 font-medium">Fecha prometida</th>
                        <th className="pb-2 font-medium">SLA</th>
                        <th className="pb-2 font-medium">Semáforo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.criticos.slice(0, 8).map((c) => {
                        const meta = SEMAFORO_META[c.semaforo];
                        return (
                          <tr key={c.id} className="text-slate-600">
                            <td className="py-1.5 font-medium text-slate-700">{c.titulo}</td>
                            <td className="py-1.5">{c.cliente}</td>
                            <td className="py-1.5">
                              <span
                                className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium"
                                style={{ background: `${c.estado_color}1a`, color: c.estado_color }}
                              >
                                {c.estado_nombre}
                              </span>
                            </td>
                            <td className="py-1.5">{c.responsable_tecnico}</td>
                            <td className="py-1.5">{fmtFecha(c.fecha_prometida)}</td>
                            <td className="py-1.5">
                              <span className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${meta.badge}`}>
                                {slaDiasLabel(c.dias_restantes)}
                              </span>
                            </td>
                            <td className="py-1.5">
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: meta.color }}>
                                <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                                {meta.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-2 border-t border-slate-100 pt-2 text-right">
                    <Link href="/dashboard/proyectos" className="text-xs font-medium text-[#4FAEB2] hover:underline">
                      Ver todos los proyectos →
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Alertas */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Alertas de hoy</h2>
              <div className="space-y-2.5">
                <Link
                  href="/dashboard/proyectos"
                  className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 transition-colors hover:bg-rose-100/60"
                >
                  <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                  <div>
                    <p className="text-sm font-semibold text-rose-700">{data.vencidos} proyectos vencidos</p>
                    <p className="text-xs text-rose-600/80">Requieren atención inmediata.</p>
                  </div>
                </Link>
                <Link
                  href="/dashboard/proyectos"
                  className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 transition-colors hover:bg-amber-100/60"
                >
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-amber-700">{data.en_riesgo} proyectos en riesgo</p>
                    <p className="text-xs text-amber-600/80">Pueden incumplir la fecha prometida.</p>
                  </div>
                </Link>
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{data.pausados} proyectos pausados</p>
                    <p className="text-xs text-slate-500">Esperando datos del cliente o en pausa.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
