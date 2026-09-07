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
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock,
  Code2,
  Download,
  LineChart,
  Quote,
  Flag,
  Hourglass,
  RefreshCw,
  Timer,
  Users,
  UsersRound,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { nombreCapitular, nombreCorto } from "@/lib/format/nombres";
import {
  AMBAR,
  Card,
  CardTitle,
  DashboardHeader,
  Estado,
  EstadoPill,
  FiltroFecha,
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
  fmtDur,
  fmtFecha,
  type Opcion,
} from "../dashboard-ui";

type Wip = { usuario_id: string; nombre: string; wip: number; nivel: "en_rango" | "al_limite" | "sobre_limite" };

type Data = {
  kpis: {
    vencen_pronto: number;
    vencidos: number;
    bloqueados: number;
    en_desarrollo: number;
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
  lead_time_horas: number | null;
  wip: Wip[];
  tiempo_por_estado: { estado_id: string; nombre: string; color: string; horas: number | null }[];
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
  bloqueos_detalle: {
    id: string;
    titulo: string;
    cliente: string;
    tipo: string;
    tipo_label: string;
    motivo: string | null;
    estado_nombre: string;
    desde: string | null;
    tiempo_ms: number | null;
  }[];
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
  // Pausado tiene su propia categoría: un proyecto en pausa está detenido, pero
  // no es un bloqueo interno, y meterlo ahí lo escondía.
  pausa: "#64748b",
};

/**
 * Cuánto pesa una detención, por el tiempo que lleva. Una pausa de tres horas y
 * una de dos semanas no son el mismo problema, y en una lista corta el color es
 * lo único que lo dice de un vistazo: la fila entera se tiñe, no sólo el número.
 */
function severidadDetencion(ms: number | null): { fila: string; badge: string; barra: string } {
  const horas = ms == null ? 0 : ms / 3600_000;
  if (horas >= 90) {
    return {
      fila: "border-rose-200 bg-gradient-to-r from-rose-50 to-white",
      badge: "bg-rose-500 text-white shadow-sm shadow-rose-500/30",
      barra: "bg-rose-500",
    };
  }
  if (horas >= 36) {
    return {
      fila: "border-orange-200 bg-gradient-to-r from-orange-50 to-white",
      badge: "bg-orange-500 text-white shadow-sm shadow-orange-500/30",
      barra: "bg-orange-500",
    };
  }
  return {
    fila: "border-slate-200 bg-white",
    badge: "bg-slate-200 text-slate-600",
    barra: "bg-slate-300",
  };
}

const SEMAFORO_PILL: Record<Data["criticos"][number]["semaforo"], string> = {
  vencido: "bg-rose-50 text-rose-700",
  critico: "bg-orange-50 text-orange-700",
  en_riesgo: "bg-amber-50 text-amber-700",
};

/**
 * Lee la respuesta con cuidado.
 *
 * Cuando algo falla aguas arriba (el gateway, por ejemplo) la respuesta no es
 * JSON sino una página HTML de error, y volcarla en la tarjeta roja llenaba
 * media pantalla con el código fuente de Cloudflare. Se muestra un mensaje
 * corto y el detalle queda en la consola, que es donde sirve.
 */
async function leerRespuesta<T>(r: Response): Promise<T> {
  const texto = await r.text();
  let j: { success?: boolean; data?: T; error?: string } | null = null;
  try {
    j = JSON.parse(texto);
  } catch {
    console.error("Respuesta no-JSON del servidor:", texto.slice(0, 2000));
    throw new Error(
      r.status >= 500
        ? `El servidor no respondió correctamente (${r.status}). Probá de nuevo en un momento.`
        : `Respuesta inesperada del servidor (${r.status}).`
    );
  }
  if (!r.ok || !j?.success || !j.data) {
    const msg = (j?.error ?? "").trim();
    // Un error largo o con HTML adentro tampoco va a la pantalla.
    const limpio = msg && msg.length < 200 && !msg.includes("<") ? msg : "No se pudo cargar el tablero.";
    throw new Error(limpio);
  }
  return j.data;
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Primer día del mes en curso: el período con el que arranca el tablero. */
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
      setData(await leerRespuesta<Data>(r));
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

  /** Los nombres del catálogo vienen en MAYÚSCULAS; en una lista gritan. */
  const tecnicos = useMemo(
    () => (data?.opciones.tecnicos ?? []).map((t) => ({ ...t, nombre: nombreCapitular(t.nombre) })),
    [data?.opciones.tecnicos]
  );

  const wipChart = useMemo(
    () => (data?.wip ?? []).slice(0, 8).map((w) => ({ ...w, corto: nombreCorto(w.nombre) })),
    [data?.wip]
  );

  /**
   * Qué población está mirando el tablero: todo el trabajo en curso más lo que
   * se cerró dentro del período. Se dice en pantalla porque un "112" y un "23"
   * en la misma tarjeta, sin su alcance al lado, se leen como si fueran lo mismo.
   */
  const alcance = useMemo(() => {
    if (!desde && !hasta) return "Cartera completa";
    if (desde && hasta) return `En curso + entregados ${fmtFecha(desde)} – ${fmtFecha(hasta)}`;
    if (desde) return `En curso + entregados desde ${fmtFecha(desde)}`;
    return `En curso + entregados hasta ${fmtFecha(hasta)}`;
  }, [desde, hasta]);

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
      ["Estancados", data.kpis.bloqueados],
      ["En desarrollo", data.kpis.en_desarrollo],
      ["Esperando cliente", data.kpis.esperando_cliente],
      ["Esperando QA", data.kpis.esperando_qa],
      ["Listos para entregar", data.kpis.listos_entregar],
      ["Técnicos con WIP alto", data.kpis.tecnicos_wip_alto],
      ["Cumplimiento de fecha prometida (%)", data.cumplimiento.pct ?? ""],
      ["Entregados en fecha", data.cumplimiento.en_fecha],
      ["Entregados con atraso", data.cumplimiento.con_atraso],
      ["En curso", data.cumplimiento.en_curso],
      ["Lead time promedio (horas)", data.lead_time_horas ?? ""],
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
      <DashboardHeader
        icon={LineChart}
        titulo="Dashboard Ejecutivo"
        subtitulo="Proyectos · visión para Directorio"
        chips={[
          <>
            <CalendarRange className="h-3 w-3" />
            {alcance}
          </>,
          <>
            <RefreshCw className="h-3 w-3" />
            {actualizado ?? "—"}
          </>,
        ]}
        acciones={
          <>
            <button
              type="button"
              onClick={() => void cargar()}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
            <button
              type="button"
              onClick={exportar}
              disabled={!data}
              className="flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3 py-2 text-[12px] font-semibold text-white shadow-sm shadow-[#4FAEB2]/30 transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Descargar
            </button>
          </>
        }
      />

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <FiltroFecha label="Desde" value={desde} max={hasta || undefined} onChange={setDesde} />
        <FiltroFecha label="Hasta" value={hasta} min={desde || undefined} onChange={setHasta} />
        <PillSelect label="Tipo" value={fTipo} onChange={setFTipo} options={data?.opciones.tipos ?? []} />
        <PillSelect
          label="Estado"
          value={fEstado}
          onChange={setFEstado}
          options={data?.opciones.estados ?? []}
          variante="color"
        />
        <PillSelect
          label="Resp. técnico"
          value={fTecnico}
          onChange={setFTecnico}
          options={tecnicos}
          variante="persona"
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
              <Kpi icon={Hourglass} tono={TONO.gris} label="Estancados" numero={data.kpis.bloqueados} />
              <Kpi icon={Code2} tono={TONO.violeta} label="En desarrollo" numero={data.kpis.en_desarrollo} />
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
                <CardTitle
                  right={
                    <span className="whitespace-nowrap text-[10px] text-slate-400">{alcance}</span>
                  }
                >
                  Proyectos por estado
                </CardTitle>
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
                    {data.lead_time_horas != null
                      ? data.lead_time_horas.toString().replace(".", ",")
                      : "—"}
                    <span className="ml-1 text-[16px] font-semibold text-slate-500">horas</span>
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
                      <BarChart data={wipChart} margin={{ top: 20, right: 6, left: -24, bottom: 0 }}>
                        <defs>
                          {Object.entries(COLOR_WIP).map(([nivel, c]) => (
                            <linearGradient key={nivel} id={`wip-${nivel}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={c} stopOpacity={1} />
                              <stop offset="100%" stopColor={c} stopOpacity={0.45} />
                            </linearGradient>
                          ))}
                        </defs>
                        <CartesianGrid vertical={false} stroke="#f1f5f9" />
                        <XAxis
                          dataKey="corto"
                          tick={{ fontSize: 9, fill: "#64748b" }}
                          axisLine={false}
                          tickLine={false}
                          interval={0}
                        />
                        <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#cbd5e1" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(79,174,178,0.06)" }}
                          formatter={(v: number) => [`${v}`, "Proyectos"]}
                        />
                        {/* La línea del límite convierte cada barra en un juicio:
                            debajo está bien, encima hay que repartir trabajo. */}
                        <ReferenceLine
                          y={data.wip_limite}
                          stroke={ROJO}
                          strokeDasharray="4 3"
                          strokeOpacity={0.7}
                        />
                        <Bar dataKey="wip" radius={[5, 5, 0, 0]} barSize={26}>
                          <LabelList
                            dataKey="wip"
                            position="top"
                            style={{ fontSize: 11, fill: "#334155", fontWeight: 700 }}
                          />
                          {wipChart.map((w) => (
                            <Cell key={w.usuario_id} fill={`url(#wip-${w.nivel})`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-1 flex flex-wrap justify-center gap-x-2.5 gap-y-1 text-[9px]">
                      <Leyenda color={ROJO} label="Sobre el límite" />
                      <Leyenda color={AMBAR} label="Al límite" />
                      <Leyenda color={VERDE} label="En rango" />
                      <span className="flex items-center gap-1 text-slate-400">
                        <span className="inline-block h-px w-4 border-t border-dashed border-rose-400" />
                        Límite {data.wip_limite}
                      </span>
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
                      <defs>
                        {data.tiempo_por_estado.map((e) => (
                          <linearGradient key={e.estado_id} id={`est-${e.estado_id}`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor={e.color} stopOpacity={0.55} />
                            <stop offset="100%" stopColor={e.color} stopOpacity={1} />
                          </linearGradient>
                        ))}
                      </defs>
                      <Tooltip
                        cursor={{ fill: "rgba(79,174,178,0.06)" }}
                        formatter={(v: number) => [`${v} h`, "Promedio"]}
                      />
                      <Bar dataKey="horas" radius={[0, 5, 5, 0]} barSize={14}>
                        <LabelList
                          dataKey="horas"
                          position="right"
                          formatter={(v: number) => `${String(v).replace(".", ",")} h`}
                          style={{ fontSize: 10.5, fill: "#334155", fontWeight: 700 }}
                        />
                        {data.tiempo_por_estado.map((e) => (
                          <Cell key={e.estado_id} fill={`url(#est-${e.estado_id})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* F. Calidad del desarrollo */}
              <Card>
                <CardTitle>Calidad del desarrollo</CardTitle>
                <div className="flex h-[168px] flex-col justify-center gap-3.5">
                  <BarraCalidad
                    valor={data.calidad.first_pass_pct}
                    label="Aprobado en primera revisión"
                    color={VERDE}
                  />
                  <BarraCalidad
                    valor={data.calidad.con_reingreso_pct}
                    label="Con reingresos desde QA"
                    color={ROJO}
                  />
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-[11px] text-slate-500">Promedio de rondas de QA</span>
                    <span className="text-[19px] font-bold leading-none text-slate-800">
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
                <CardTitle
                  right={
                    <span className="whitespace-nowrap text-[10px] text-slate-400">
                      {data.bloqueados_total} detenidos
                    </span>
                  }
                >
                  Bloqueos y pausas
                </CardTitle>
                {data.bloqueos_detalle.length === 0 ? (
                  <div className="flex h-[150px] flex-col items-center justify-center gap-1.5 text-center">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                    <p className="text-[12px] font-medium text-slate-500">Nada detenido</p>
                  </div>
                ) : (
                  <>
                    {/* Desglose por tipo en una línea: con pocos proyectos un
                        anillo de un solo color no dice nada que esto no diga. */}
                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                      {data.bloqueos_por_tipo.map((b) => (
                        <span
                          key={b.tipo}
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          style={{
                            background: `${COLOR_BLOQUEO[b.tipo] ?? TEAL}18`,
                            color: COLOR_BLOQUEO[b.tipo] ?? TEAL,
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: COLOR_BLOQUEO[b.tipo] ?? TEAL }}
                          />
                          {b.label}
                          <span className="tabular-nums opacity-70">{b.cantidad}</span>
                        </span>
                      ))}
                    </div>
                    <ul className="space-y-2">
                      {data.bloqueos_detalle.map((b) => {
                        const color = COLOR_BLOQUEO[b.tipo] ?? TEAL;
                        const sev = severidadDetencion(b.tiempo_ms);
                        return (
                          <li
                            key={b.id}
                            className={`group relative overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-px hover:shadow-md ${sev.fila}`}
                          >
                            {/* Franja del color del tipo: identifica la causa sin
                                gastar una columna de texto. */}
                            <span
                              aria-hidden
                              className="absolute inset-y-0 left-0 w-1"
                              style={{ background: color }}
                            />
                            <div className="py-2 pl-3.5 pr-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <Link
                                  href={`/dashboard/proyectos?proyecto=${b.id}`}
                                  className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-800 hover:text-[#2F6E71] hover:underline"
                                  title={b.titulo}
                                >
                                  {b.titulo}
                                </Link>
                                <span
                                  className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums ${sev.badge}`}
                                >
                                  <Clock className="h-2.5 w-2.5" />
                                  {fmtDur(b.tiempo_ms)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wide"
                                  style={{ background: `${color}1F`, color }}
                                >
                                  {b.tipo_label}
                                </span>
                                <span
                                  className="min-w-0 truncate text-[10.5px] text-slate-400"
                                  title={b.cliente}
                                >
                                  {b.cliente}
                                </span>
                              </div>
                              <div className="mt-1 flex items-start gap-1.5">
                                <Quote className="mt-0.5 h-3 w-3 shrink-0 text-slate-300" />
                                {/* Sin motivo cargado se dice que falta, en vez de
                                    repetir el estado y aparentar que hay una razón. */}
                                {b.motivo ? (
                                  <span className="text-[11px] font-medium leading-snug text-slate-700">
                                    {b.motivo}
                                  </span>
                                ) : (
                                  <span className="text-[11px] italic leading-snug text-slate-300">
                                    Sin motivo cargado
                                  </span>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
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
                Datos en vivo del módulo Proyectos
              </span>
            </div>
          </>
        ) : null}
      </Estado>
    </div>
  );
}

/**
 * Número grande con su barra de progreso.
 *
 * El porcentaje solo no dice cuánto falta para el ideal; la barra lo muestra
 * sin que haya que pensarlo.
 */
function BarraCalidad({
  valor,
  label,
  color,
}: {
  valor: number | null;
  label: string;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[30px] font-bold leading-none" style={{ color }}>
          {valor != null ? `${valor}%` : "—"}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, valor ?? 0))}%`, background: color }}
        />
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{label}</div>
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
