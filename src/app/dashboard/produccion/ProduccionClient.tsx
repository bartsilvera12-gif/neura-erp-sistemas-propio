"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Factory, Lock } from "lucide-react";
import { useProduccion } from "@/shared/hooks/useProduccion";
import { pct, pctColor } from "@/lib/report/format";
import { CategoryBars, Kpi, Metric, Semaforo, SummaryCard, Table } from "@/components/ui/report";
import { PROYECTO_ETAPAS } from "@/lib/proyectos/etapas-desarrollo";

const TEAL = "#4FAEB2";
const ETAPA_LABEL: Record<string, string> = Object.fromEntries(PROYECTO_ETAPAS.map((e) => [e.codigo, e.label]));
const ETAPA_COLOR: Record<string, string> = Object.fromEntries(PROYECTO_ETAPAS.map((e) => [e.codigo, e.color]));
const KANBAN_HREF = "/dashboard/proyectos";

const nd = (n: number | null): string => (n == null ? "—" : `${n} d`);
const pctPlain = (n: number | null): string => (n == null ? "—" : `${n}%`);

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ProduccionClient() {
  const [period, setPeriod] = useState(thisMonth());
  const { report, isLoading, error } = useProduccion(period);

  const periodOptions = useMemo(() => {
    const opts: string[] = [];
    const d = new Date();
    for (let i = 0; i < 8; i++) {
      opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      d.setMonth(d.getMonth() - 1);
    }
    return opts;
  }, []);

  // Derivados de ritmo (avance temporal del mes + proyección).
  const ritmo = useMemo(() => {
    if (!report) return null;
    const isCurrent = report.period === thisMonth();
    const [yy, mm] = report.period.split("-").map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const dia = isCurrent ? new Date().getDate() : daysInMonth;
    const pctMes = daysInMonth ? (dia / daysInMonth) * 100 : 0;
    const proyeccion = isCurrent && pctMes > 0 ? Math.round(report.kpis.entregados_mes / (pctMes / 100)) : null;
    return { isCurrent, daysInMonth, dia, pctMes, proyeccion };
  }, [report]);

  const carga = useMemo(() => {
    if (!report) return null;
    const top = report.carga_por_tecnico.filter((t) => t.tecnico_id !== null).slice(0, 1)[0] ?? null;
    const sinAsignar = report.carga_por_tecnico.find((t) => t.tecnico_id === null) ?? null;
    const totalWip = report.carga_por_tecnico.reduce((a, t) => a + t.wip, 0);
    const aging30 = report.aging_buckets.find((b) => b.bucket === "30+")?.cantidad ?? 0;
    const esperaCliente = report.salud.find((s) => s.clave === "espera_cliente")?.cantidad ?? 0;
    return { top, sinAsignar, totalWip, aging30, esperaCliente };
  }, [report]);

  const is403 = error?.status === 403;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[#4FAEB2]">
            <Factory className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Producción</h1>
            <p className="text-sm text-slate-500">Tablero de programación · flujo, cuellos de botella y entregas</p>
          </div>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-[#4FAEB2] focus:outline-none"
        >
          {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </header>

      {is403 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Acceso restringido</p>
            <p>Este reporte está disponible para gerencia y administración. Si necesitás acceso, pedilo a un administrador.</p>
          </div>
        </div>
      )}
      {error && !is403 && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">No se pudo cargar el reporte.</div>
      )}

      {isLoading && !report && !error && <SkeletonBoard />}

      {report && !is403 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Entregados del mes" value={String(report.kpis.entregados_mes)} sub={pct(report.kpis.variacion_entregados_pct)} subColor={pctColor(report.kpis.variacion_entregados_pct)} accent />
            <Kpi label="WIP activo" value={String(report.kpis.wip_activo)} sub="en curso" />
            <Kpi label="Lead time (mediana)" value={nd(report.kpis.lead_time_mediana_dias)} sub={`p85 ${nd(report.kpis.lead_time_p85_dias)}`} />
            <Kpi label="Cycle time técnico" value={nd(report.kpis.cycle_time_mediana_dias)} sub={`p85 ${nd(report.kpis.cycle_time_p85_dias)}`} />
            <Kpi label="Cumpl. fecha prometida" value={pctPlain(report.kpis.cumplimiento_fecha_prometida_pct)} sub="de los entregados con fecha" />
            <Kpi label="Estancados (área)" value={String(report.kpis.estancados)} sub={`${report.kpis.cancelados_mes} cancelados`} subColor={report.kpis.estancados > 0 ? "text-rose-600" : undefined} />
          </div>

          {/* Ritmo + Salud */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Ritmo del mes</h2>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Metric label="Entregados" value={String(report.kpis.entregados_mes)} />
                <Metric label="Mes anterior (total)" value={String(report.kpis.entregados_mes_anterior)} />
                <Metric label="Variación" value={pct(report.kpis.variacion_entregados_pct)} subColor={pctColor(report.kpis.variacion_entregados_pct)} />
                <Metric label="Día del mes" value={ritmo ? `${ritmo.dia} / ${ritmo.daysInMonth}` : "—"} sub={ritmo ? `${ritmo.pctMes.toFixed(0)}% transcurrido` : undefined} />
                <Metric label="Proyección fin de mes" value={ritmo?.proyeccion == null ? "—" : String(ritmo.proyeccion)} sub={ritmo?.isCurrent ? "al ritmo actual" : "mes cerrado"} />
                <div className="self-end">
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#4FAEB2]" style={{ width: `${Math.min(100, ritmo?.pctMes ?? 0)}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">avance temporal del mes</div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Salud de producción</h2>
              <div className="space-y-2">
                {report.salud.map((s) => <Semaforo key={s.clave} label={s.label} tone={s.tono} detail={s.detalle} />)}
              </div>
            </div>
          </div>

          {/* SummaryCards */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <SummaryCard title="Carga del equipo" tone="slate">
              <Metric label="WIP total" value={String(carga?.totalWip ?? 0)} />
              <Metric label="Técnico con más carga" value={carga?.top ? carga.top.tecnico_nombre : "—"} sub={carga?.top ? `${carga.top.wip} en curso` : undefined} />
              <Metric label="Sin asignar" value={String(carga?.sinAsignar?.wip ?? 0)} subColor={(carga?.sinAsignar?.wip ?? 0) > 0 ? "text-amber-600" : undefined} />
              <Metric label="Entregados (equipo)" value={String(report.carga_por_tecnico.reduce((a, t) => a + t.entregados_mes, 0))} />
            </SummaryCard>
            <SummaryCard title="Cuellos de botella" tone={report.kpis.estancados > 0 ? "rose" : "emerald"}>
              <Metric label="Estancados (área)" value={String(report.kpis.estancados)} subColor={report.kpis.estancados > 0 ? "text-rose-600" : undefined} />
              <Metric label="Espera del cliente" value={String(carga?.esperaCliente ?? 0)} />
              <Metric label="Aging +30 días" value={String(carga?.aging30 ?? 0)} subColor={(carga?.aging30 ?? 0) > 0 ? "text-amber-600" : undefined} />
              <Metric label="Cancelados del mes" value={String(report.kpis.cancelados_mes)} />
            </SummaryCard>
            <SummaryCard title="Higiene de datos" tone={report.higiene_datos.con_fecha_prometida_pct < 40 ? "amber" : "slate"}>
              <Metric label="Con fecha prometida" value={pctPlain(report.higiene_datos.con_fecha_prometida_pct)} subColor={report.higiene_datos.con_fecha_prometida_pct < 40 ? "text-amber-600" : undefined} />
              <Metric label="Con técnico asignado" value={pctPlain(report.higiene_datos.con_tecnico_asignado_pct)} />
              <Metric label="Con monto vendido" value={pctPlain(report.higiene_datos.con_monto_vendido_pct)} />
              <Metric label="Base (WIP)" value={String(report.higiene_datos.total_activos)} sub="proyectos activos" />
            </SummaryCard>
          </div>

          {/* WIP por estado + etapa */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">WIP por estado (Kanban)</h2>
              {report.wip_por_estado.length === 0 ? (
                <p className="text-sm text-slate-400">Sin proyectos en curso</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={report.wip_por_estado}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f5" />
                    <XAxis dataKey="nombre" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} width={30} />
                    <Tooltip formatter={(v: number) => [`${v} proyectos`, "WIP"]} />
                    <Bar dataKey="cantidad" radius={[4, 4, 0, 0]}>
                      {report.wip_por_estado.map((e) => <Cell key={e.estado_id} fill={e.color || TEAL} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">WIP por etapa de desarrollo</h2>
              <CategoryBars
                rows={report.wip_por_etapa.map((e) => ({ categoria: e.etapa, facturado: e.cantidad, facturas: e.cantidad }))}
                labelMap={ETAPA_LABEL}
                colorMap={ETAPA_COLOR}
                format={(n) => String(n)}
                unitLabel="en curso"
              />
            </div>
          </div>

          {/* Detalle */}
          <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Detalle (resumen)</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Table
              title="Estancados"
              cols={["Cliente", "Estado", "Etapa", "Días"]}
              rows={report.detalle.estancados.map((d) => [d.cliente ?? "—", d.estado_nombre, d.etapa, nd(d.dias_en_estado)])}
              total={report.detalle.estancados.length}
              empty="Sin proyectos estancados ✓"
              href={KANBAN_HREF}
            />
            <Table
              title="Por vencer (fecha prometida)"
              cols={["Cliente", "Estado", "Técnico", "Prometida"]}
              rows={report.detalle.por_vencer.map((d) => [d.cliente ?? "—", d.estado_nombre, d.tecnico_nombre ?? "—", fmtFecha(d.fecha_prometida)])}
              total={report.detalle.por_vencer.length}
              empty="Nada por vencer en la ventana"
              href={KANBAN_HREF}
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Table
              title="Sin técnico asignado"
              cols={["Cliente", "Estado", "Etapa", "Días"]}
              rows={report.detalle.sin_tecnico.map((d) => [d.cliente ?? "—", d.estado_nombre, d.etapa, nd(d.dias_en_estado)])}
              total={report.detalle.sin_tecnico.length}
              empty="Todos los proyectos tienen técnico ✓"
              href={KANBAN_HREF}
            />
            <Table
              title="Entregados del mes"
              cols={["Cliente", "Técnico", "Lead", "Cumplió"]}
              rows={report.detalle.entregados_mes.map((d) => [d.cliente ?? "—", d.tecnico_nombre ?? "—", nd(d.lead_time_dias), d.cumplio == null ? "—" : d.cumplio ? "Sí" : "No"])}
              total={report.detalle.entregados_mes.length}
              empty="Sin entregas registradas este mes"
              href={KANBAN_HREF}
            />
          </div>

          <p className="mt-4 text-xs text-slate-400">
            &quot;Entregado&quot; = primera transición a un estado final activo, excluyendo cancelación (contador aparte).
            Estancado = tiempo en estado sobre umbral (SLA del estado, o 7d interno / 21d cliente). Tono neutro =
            espera externa, no falla del área. Generado {new Date(report.generated_at).toLocaleString("es-PY")}.
          </p>
        </>
      )}
    </div>
  );
}

function fmtFecha(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" });
}

function SkeletonBoard() {
  return (
    <div className="animate-pulse">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-slate-100" />)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="h-48 rounded-xl bg-slate-100 lg:col-span-2" />
        <div className="h-48 rounded-xl bg-slate-100" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-36 rounded-xl bg-slate-100" />)}
      </div>
    </div>
  );
}
