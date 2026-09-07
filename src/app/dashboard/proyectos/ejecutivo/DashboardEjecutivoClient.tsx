"use client";

/**
 * Dashboard Ejecutivo — Proyectos, visión para Directorio.
 *
 * Es un RESUMEN, no una pantalla de trabajo: responde "cómo está funcionando la
 * cartera" y nada más. Lo operativo (a quién hay que apurar hoy, qué proyecto
 * está sin movimiento) vive en el Dashboard PM a propósito; meterlo acá lo
 * convertiría en otra bandeja de tareas.
 *
 * Todos los números salen de `/api/proyectos/dashboard-ejecutivo`, que a su vez
 * sale del módulo Proyectos. Acá no se calcula nada: si el cliente recalculara,
 * tarde o temprano diría algo distinto que la API.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  AlertTriangle,
  Download,
  Flag,
  Hourglass,
  Lock,
  RefreshCw,
  Timer,
  Users,
  UsersRound,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { nombreCorto } from "@/lib/format/nombres";
import {
  AMBAR,
  Card,
  CardTitle,
  Estado,
  EstadoPill,
  FiltroPill,
  Kpi,
  NARANJA,
  Pill,
  PillSelect,
  ROJO,
  TEAL,
  TONO,
  TablaWrap,
  VERDE,
  fmtDias,
  fmtFecha,
  type Opcion,
} from "../dashboard-ui";

type Wip = { usuario_id: string; nombre: string; wip: number; nivel: "en_rango" | "al_limite" | "sobre_limite" };

type Data = {
  kpis: {
    vencen_pronto: number;
    vencidos: number;
    bloqueados: number;
    estancados: number;
    esperando_cliente: number;
    esperando_qa: number;
    listos_entregar: number;
    tecnicos_wip_alto: number;
  };
  total_tecnicos: number;
  wip_limite: number;
  total_proyectos: number;
  por_estado: { estado_id: string; nombre: string; color: string; cantidad: number }[];
  cumplimiento: { pct: number | null; en_fecha: number; con_atraso: number; en_curso: number };
  lead_time_jornadas: number | null;
  wip: Wip[];
  tiempo_por_estado: { estado_id: string; nombre: string; color: string; jornadas: number | null }[];
  calidad: {
    first_pass_pct: number | null;
    con_reingreso_pct: number | null;
    promedio_rondas: number | null;
  };
  criticos: {
    id: string;
    titulo: string;
    cliente: string;
    estado_nombre: string;
    estado_color: string;
    tecnico: string;
    fecha_prometida: string | null;
    dias_restantes: number | null;
    motivo: string;
    semaforo: "vencido" | "critico" | "en_riesgo";
  }[];
  bloqueos_por_tipo: { tipo: string; label: string; cantidad: number }[];
  bloqueados_total: number;
  opciones: { tipos: Opcion[]; estados: Opcion[]; tecnicos: Opcion[] };
  atribucion_parcial: boolean;
};

const COLOR_WIP: Record<Wip["nivel"], string> = {
  sobre_limite: ROJO,
  al_limite: AMBAR,
  en_rango: VERDE,
};

const COLOR_BLOQUEO: Record<string, string> = {
  cliente: AMBAR,
  tercero: "#8b5cf6",
  interno: ROJO,
};

const SEMAFORO_PILL: Record<Data["criticos"][number]["semaforo"], string> = {
  vencido: "bg-rose-50 text-rose-700",
  critico: "bg-orange-50 text-orange-700",
  en_riesgo: "bg-amber-50 text-amber-700",
};

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Primer día del mes en curso: el período que mira Dirección por defecto. */
function inicioMes(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function DashboardEjecutivoClient() {
  const [desde, setDesde] = useState(inicioMes);
  const [hasta, setHasta] = useState(hoyIso);
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fTecnico, setFTecnico] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      if (fTipo) qs.set("tipo_id", fTipo);
      if (fEstado) qs.set("estado_id", fEstado);
      if (fTecnico) qs.set("responsable_tecnico_id", fTecnico);
      const r = await fetchWithSupabaseSession(`/api/proyectos/dashboard-ejecutivo?${qs}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as { success?: boolean; data?: Data; error?: string };
      if (!r.ok || !j.success || !j.data) throw new Error(j.error ?? "No se pudo cargar");
      setData(j.data);
      setActualizado(new Date().toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, fTipo, fEstado, fTecnico]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const donut = useMemo(
    () => (data?.por_estado ?? []).map((e) => ({ ...e, value: e.cantidad })),
    [data?.por_estado]
  );

  const wipChart = useMemo(
    () => (data?.wip ?? []).slice(0, 8).map((w) => ({ ...w, corto: nombreCorto(w.nombre) })),
    [data?.wip]
  );

  const bloqueosDonut = useMemo(
    () => (data?.bloqueos_por_tipo ?? []).map((b) => ({ ...b, value: b.cantidad })),
    [data?.bloqueos_por_tipo]
  );

  /**
   * Descarga del resumen en CSV. Es el formato que abre Excel sin pedir nada y
   * que además entra en cualquier planilla: para un resumen de Directorio no
   * hace falta arrastrar una librería de xlsx a esta pantalla.
   */
  const exportar = useCallback(() => {
    if (!data) return;
    const filas: (string | number)[][] = [
      ["Dashboard Ejecutivo — Proyectos"],
      ["Período", `${desde} a ${hasta}`],
      [],
      ["Indicador", "Valor"],
      ["Vencen pronto", data.kpis.vencen_pronto],
      ["Vencidos", data.kpis.vencidos],
      ["Bloqueados", data.kpis.bloqueados],
      ["Estancados", data.kpis.estancados],
      ["Esperando cliente", data.kpis.esperando_cliente],
      ["Esperando QA", data.kpis.esperando_qa],
      ["Listos para entregar", data.kpis.listos_entregar],
      ["Técnicos con WIP alto", data.kpis.tecnicos_wip_alto],
      ["Cumplimiento de fecha prometida (%)", data.cumplimiento.pct ?? ""],
      ["Entregados en fecha", data.cumplimiento.en_fecha],
      ["Entregados con atraso", data.cumplimiento.con_atraso],
      ["En curso", data.cumplimiento.en_curso],
      ["Lead time promedio (jornadas)", data.lead_time_jornadas ?? ""],
      ["First pass QA (%)", data.calidad.first_pass_pct ?? ""],
      ["Con reingresos de QA (%)", data.calidad.con_reingreso_pct ?? ""],
      ["Promedio de rondas de QA", data.calidad.promedio_rondas ?? ""],
      [],
      ["Proyectos por estado", "Cantidad"],
      ...data.por_estado.map((e) => [e.nombre, e.cantidad]),
      [],
      ["Técnico", "WIP"],
      ...data.wip.map((w) => [w.nombre, w.wip]),
      [],
      ["Proyecto", "Cliente", "Estado", "Técnico", "Fecha prometida", "Días", "Motivo"],
      ...data.criticos.map((c) => [
        c.titulo,
        c.cliente,
        c.estado_nombre,
        c.tecnico,
        fmtFecha(c.fecha_prometida),
        fmtDias(c.dias_restantes),
        c.motivo,
      ]),
    ];
    const csv = filas
      .map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    // BOM para que Excel reconozca los acentos.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Dashboard-Ejecutivo-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data, desde, hasta]);

  return (
    <div className="space-y-3">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-slate-800">
            Dashboard Ejecutivo
          </h1>
          <p className="text-[13px] text-slate-500">Proyectos · Visión para Directorio</p>
          <p className="text-[12px] text-slate-400">
            Estado general, cumplimiento y productividad del área técnica
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void cargar()}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            type="button"
            onClick={exportar}
            disabled={!data}
            className="flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Descargar
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <FiltroPill label="Desde">
          <input
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
            className="w-full cursor-pointer bg-transparent text-right text-[13px] text-slate-500 focus:outline-none"
          />
        </FiltroPill>
        <FiltroPill label="Hasta">
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
            className="w-full cursor-pointer bg-transparent text-right text-[13px] text-slate-500 focus:outline-none"
          />
        </FiltroPill>
        <PillSelect label="Tipo" value={fTipo} onChange={setFTipo} options={data?.opciones.tipos ?? []} />
        <PillSelect label="Estado" value={fEstado} onChange={setFEstado} options={data?.opciones.estados ?? []} />
        <PillSelect
          label="Resp. técnico"
          value={fTecnico}
          onChange={setFTecnico}
          options={data?.opciones.tecnicos ?? []}
        />
      </div>

      <Estado loading={loading && !data} error={err} vacio={!!data && data.total_proyectos === 0}>
        {data ? (
          <>
            {/* KPIs — dos filas de cuatro, como el diseño */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Kpi
                icon={Timer}
                tono={TONO.ambar}
                label="Vencen pronto"
                sublabel="≤ 3 días"
                numero={data.kpis.vencen_pronto}
              />
              <Kpi icon={AlertCircle} tono={TONO.rojo} label="Vencidos" numero={data.kpis.vencidos} />
              <Kpi icon={Lock} tono={TONO.gris} label="Bloqueados" numero={data.kpis.bloqueados} />
              <Kpi icon={Hourglass} tono={TONO.naranja} label="Estancados" numero={data.kpis.estancados} />
              <Kpi
                icon={Users}
                tono={TONO.violeta}
                label="Esperando cliente"
                numero={data.kpis.esperando_cliente}
              />
              <Kpi icon={AlertTriangle} tono={TONO.azul} label="Esperando QA" numero={data.kpis.esperando_qa} />
              <Kpi icon={Flag} tono={TONO.verde} label="Listos para entregar" numero={data.kpis.listos_entregar} />
              <Kpi
                icon={UsersRound}
                tono={TONO.rojo}
                label="Técnicos con WIP alto"
                numero={data.kpis.tecnicos_wip_alto}
                pie={`de ${data.total_tecnicos} técnicos`}
              />
            </div>

            {/* A · B · C */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {/* A. Proyectos por estado */}
              <Card>
                <CardTitle>Proyectos por estado</CardTitle>
                {donut.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin datos</p>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="relative h-[150px] w-[150px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donut}
                            dataKey="value"
                            nameKey="nombre"
                            innerRadius={46}
                            outerRadius={72}
                            paddingAngle={1}
                            strokeWidth={0}
                            labelLine={false}
                          >
                            {donut.map((e) => (
                              <Cell key={e.estado_id} fill={e.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number, n: string) => [`${v}`, n]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[20px] font-bold leading-none text-slate-800">
                          {data.total_proyectos}
                        </span>
                        <span className="text-[10px] text-slate-400">proyectos</span>
                      </div>
                    </div>
                    <ul className="min-w-0 flex-1 space-y-1">
                      {donut.map((e) => (
                        <li
                          key={e.estado_id}
                          className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-600"
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.color }} />
                          <span className="min-w-0 flex-1 truncate" title={e.nombre}>
                            {e.nombre}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums text-slate-700">{e.cantidad}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              {/* B. Cumplimiento de fecha prometida */}
              <Card>
                <CardTitle>Cumplimiento de fecha prometida</CardTitle>
                <div className="flex flex-col items-center">
                  <Medidor valor={data.cumplimiento.pct} />
                  <ul className="mt-2 w-full space-y-1">
                    <FilaLeyenda color={VERDE} label="Entregados en fecha" valor={data.cumplimiento.en_fecha} />
                    <FilaLeyenda color={ROJO} label="Con atraso" valor={data.cumplimiento.con_atraso} />
                    <FilaLeyenda color={AMBAR} label="En curso" valor={data.cumplimiento.en_curso} />
                  </ul>
                </div>
              </Card>

              {/* C. Lead time */}
              <Card>
                <CardTitle>Lead time promedio</CardTitle>
                <div className="flex h-[150px] flex-col items-center justify-center">
                  <span className="text-[34px] font-bold leading-none tracking-tight text-slate-800">
                    {data.lead_time_jornadas != null
                      ? data.lead_time_jornadas.toString().replace(".", ",")
                      : "—"}
                    <span className="ml-1 text-[16px] font-semibold text-slate-500">jornadas</span>
                  </span>
                  <span className="mt-2 text-center text-[11px] text-slate-400">
                    Del ingreso a la primera entrega, en horas laborales
                  </span>
                </div>
              </Card>
            </div>

            {/* D · E · F */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {/* D. Carga del equipo */}
              <Card>
                <CardTitle>Carga del equipo (WIP)</CardTitle>
                {wipChart.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin datos</p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={168}>
                      <BarChart data={wipChart} margin={{ top: 18, right: 6, left: -24, bottom: 0 }}>
                        <XAxis
                          dataKey="corto"
                          tick={{ fontSize: 9, fill: "#94a3b8" }}
                          axisLine={false}
                          tickLine={false}
                          interval={0}
                        />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v: number) => [`${v}`, "Proyectos"]} />
                        <Bar dataKey="wip" radius={[3, 3, 0, 0]} barSize={22}>
                          <LabelList
                            dataKey="wip"
                            position="top"
                            style={{ fontSize: 10, fill: "#475569", fontWeight: 600 }}
                          />
                          {wipChart.map((w) => (
                            <Cell key={w.usuario_id} fill={COLOR_WIP[w.nivel]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[9px] text-slate-500">
                      <Leyenda color={ROJO} label="Sobre el límite" />
                      <Leyenda color={AMBAR} label="Al límite" />
                      <Leyenda color={VERDE} label="En rango" />
                      <span className="text-slate-400">Límite recomendado: {data.wip_limite}</span>
                    </div>
                  </>
                )}
              </Card>

              {/* E. Tiempo promedio en cada estado */}
              <Card>
                <CardTitle>Tiempo promedio en cada estado</CardTitle>
                {data.tiempo_por_estado.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin datos</p>
                ) : (
                  <ResponsiveContainer width="100%" height={168}>
                    <BarChart
                      layout="vertical"
                      data={data.tiempo_por_estado}
                      margin={{ top: 4, right: 42, left: 4, bottom: 0 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="nombre"
                        width={96}
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <Tooltip formatter={(v: number) => [`${v} jornadas`, "Promedio"]} />
                      <Bar dataKey="jornadas" radius={[0, 3, 3, 0]} barSize={12}>
                        <LabelList
                          dataKey="jornadas"
                          position="right"
                          formatter={(v: number) => `${String(v).replace(".", ",")} j`}
                          style={{ fontSize: 10, fill: "#475569", fontWeight: 600 }}
                        />
                        {data.tiempo_por_estado.map((e) => (
                          <Cell key={e.estado_id} fill={e.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* F. Calidad del desarrollo */}
              <Card>
                <CardTitle>Calidad del desarrollo</CardTitle>
                <div className="flex h-[168px] flex-col justify-center gap-3">
                  <div>
                    <div className="text-[30px] font-bold leading-none text-emerald-500">
                      {data.calidad.first_pass_pct != null ? `${data.calidad.first_pass_pct}%` : "—"}
                    </div>
                    <div className="text-[11px] text-slate-500">Aprobado en primera revisión</div>
                  </div>
                  <div>
                    <div className="text-[30px] font-bold leading-none text-rose-500">
                      {data.calidad.con_reingreso_pct != null ? `${data.calidad.con_reingreso_pct}%` : "—"}
                    </div>
                    <div className="text-[11px] text-slate-500">Con reingresos desde QA</div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Promedio de rondas de QA{" "}
                    <span className="text-[18px] font-bold text-slate-800">
                      {data.calidad.promedio_rondas != null
                        ? data.calidad.promedio_rondas.toString().replace(".", ",")
                        : "—"}
                    </span>
                  </div>
                </div>
              </Card>
            </div>

            {/* G · H */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardTitle
                  right={
                    <Link
                      href="/dashboard/proyectos"
                      className="whitespace-nowrap text-[11px] font-medium text-[#4FAEB2] hover:underline"
                    >
                      Ver todos →
                    </Link>
                  }
                >
                  Proyectos críticos
                </CardTitle>
                {data.criticos.length === 0 ? (
                  <p className="text-sm text-slate-400">Nada crítico. Buen día.</p>
                ) : (
                  <TablaWrap>
                    <table className="w-full min-w-[680px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="pb-1.5 pr-2 font-medium">Proyecto</th>
                          <th className="pb-1.5 pr-2 font-medium">Cliente</th>
                          <th className="pb-1.5 pr-2 font-medium">Estado</th>
                          <th className="pb-1.5 pr-2 font-medium">Técnico</th>
                          <th className="pb-1.5 pr-2 font-medium">Prometida</th>
                          <th className="pb-1.5 pr-2 font-medium">Días</th>
                          <th className="pb-1.5 font-medium">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.criticos.map((c) => (
                          <tr key={c.id} className="border-b border-slate-50 text-[11px] last:border-0">
                            <td className="max-w-[150px] truncate py-1.5 pr-2 font-medium text-slate-700">
                              <Link href={`/dashboard/proyectos?proyecto=${c.id}`} className="hover:underline" title={c.titulo}>
                                {c.titulo}
                              </Link>
                            </td>
                            <td className="max-w-[140px] truncate py-1.5 pr-2 text-slate-500" title={c.cliente}>
                              {c.cliente}
                            </td>
                            <td className="py-1.5 pr-2">
                              <EstadoPill nombre={c.estado_nombre} color={c.estado_color} />
                            </td>
                            <td className="max-w-[110px] truncate py-1.5 pr-2 text-slate-500">
                              {nombreCorto(c.tecnico)}
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-slate-500">
                              {fmtFecha(c.fecha_prometida)}
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums font-semibold text-slate-600">
                              {fmtDias(c.dias_restantes)}
                            </td>
                            <td className="py-1.5">
                              <Pill className={SEMAFORO_PILL[c.semaforo]}>{c.motivo}</Pill>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TablaWrap>
                )}
              </Card>

              <Card>
                <CardTitle>Bloqueos por tipo</CardTitle>
                {bloqueosDonut.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin bloqueos activos</p>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="relative h-[132px] w-[132px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={bloqueosDonut}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={40}
                            outerRadius={64}
                            paddingAngle={1}
                            strokeWidth={0}
                            labelLine={false}
                          >
                            {bloqueosDonut.map((b) => (
                              <Cell key={b.tipo} fill={COLOR_BLOQUEO[b.tipo] ?? TEAL} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number, n: string) => [`${v}`, n]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[19px] font-bold leading-none text-slate-800">
                          {data.bloqueados_total}
                        </span>
                        <span className="text-[10px] text-slate-400">bloqueados</span>
                      </div>
                    </div>
                    <ul className="min-w-0 flex-1 space-y-1">
                      {bloqueosDonut.map((b) => (
                        <li key={b.tipo} className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-600">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: COLOR_BLOQUEO[b.tipo] ?? TEAL }}
                          />
                          <span className="flex-1">{b.label}</span>
                          <span className="font-semibold tabular-nums text-slate-700">{b.cantidad}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
              <span>
                {data.atribucion_parcial
                  ? "Parte del historial anterior al snapshot de técnico tiene atribución aproximada."
                  : "Atribución técnica completa sobre el historial."}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Última actualización: {actualizado ?? "—"}
              </span>
            </div>
          </>
        ) : null}
      </Estado>
    </div>
  );
}

function Leyenda({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function FilaLeyenda({ color, label, valor }: { color: string; label: string; valor: number }) {
  return (
    <li className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-600">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums text-slate-700">{valor}</span>
    </li>
  );
}

/**
 * Medidor semicircular del cumplimiento. Es un SVG a mano y no un gráfico: son
 * dos arcos: una librería entera para esto sería más código, no menos.
 */
function Medidor({ valor }: { valor: number | null }) {
  const pct = valor ?? 0;
  const R = 58;
  const largo = Math.PI * R;
  const color = pct >= 90 ? VERDE : pct >= 70 ? AMBAR : pct > 0 ? NARANJA : "#e2e8f0";
  return (
    <div className="relative h-[92px] w-[150px]">
      <svg viewBox="0 0 150 84" className="h-full w-full" aria-hidden>
        <path
          d={`M 17 75 A ${R} ${R} 0 0 1 133 75`}
          fill="none"
          stroke="#eef2f7"
          strokeWidth={13}
          strokeLinecap="round"
        />
        <path
          d={`M 17 75 A ${R} ${R} 0 0 1 133 75`}
          fill="none"
          stroke={color}
          strokeWidth={13}
          strokeLinecap="round"
          strokeDasharray={largo}
          strokeDashoffset={largo * (1 - Math.min(100, Math.max(0, pct)) / 100)}
        />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
        <span className="text-[26px] font-bold leading-none text-slate-800">
          {valor != null ? `${valor}%` : "—"}
        </span>
      </div>
    </div>
  );
}
