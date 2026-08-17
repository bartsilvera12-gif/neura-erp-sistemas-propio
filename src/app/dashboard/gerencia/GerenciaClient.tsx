"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { ComercialReport } from "@/lib/gerencia/comercial-data";
import { gs, gsShort, pct, pctColor } from "@/lib/report/format";
import { CategoryBars, Kpi, Metric, Semaforo, SummaryCard, Table, TONE, type Tone } from "@/components/ui/report";

const TEAL = "#4FAEB2";
const CAT_LABEL: Record<string, string> = {
  contabilidad: "Contabilidad", saas_erp: "SaaS / ERP", web_landing: "Web / Landing",
  marketing: "Marketing", branding: "Branding", otros: "Otros", sin_clasificar: "Sin clasificar",
};
const CAT_COLOR: Record<string, string> = {
  contabilidad: "#4FAEB2", saas_erp: "#6366f1", web_landing: "#f59e0b",
  marketing: "#ec4899", branding: "#8b5cf6", otros: "#94a3b8", sin_clasificar: "#cbd5e1",
};

type Report = ComercialReport;
async function fetchReport(period: string): Promise<ComercialReport> {
  const res = await fetchWithSupabaseSession(`/api/gerencia/comercial?period=${period}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function GerenciaClient() {
  const [period, setPeriod] = useState(thisMonth());
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true); setError(null);
    try { setData(await fetchReport(p)); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const periodOptions = useMemo(() => {
    const opts: string[] = [];
    const d = new Date();
    for (let i = 0; i < 8; i++) { opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); d.setMonth(d.getMonth() - 1); }
    return opts;
  }, []);

  // ── Derivados ejecutivos (todo calculado en cliente desde el payload; sin tocar API/views) ──
  const m = useMemo(() => {
    if (!data) return null;
    const isCurrent = data.period === thisMonth();
    const [yy, mm] = data.period.split("-").map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const diaTrans = data.igual_dia.dia || 0;
    const pctMes = daysInMonth ? (diaTrans / daysInMonth) * 100 : 0;
    const ritmoPct = data.igual_dia.diff_pct;
    const ritmoEstado: { t: string; tone: Tone } =
      ritmoPct == null ? { t: "Sin referencia", tone: "slate" }
        : ritmoPct >= 5 ? { t: "Por encima", tone: "emerald" }
          : ritmoPct <= -5 ? { t: "Por debajo", tone: "rose" }
            : { t: "En línea", tone: "amber" };
    const proyeccion = isCurrent && pctMes > 0 ? data.igual_dia.facturado_actual / (pctMes / 100) : null;

    // Pendientes de cobro
    const pend = data.pendientes_cobro;
    const pendTotal = data.kpis.pendiente_cobro;
    const vencido30 = pend.filter((p) => (p.dias_atraso ?? 0) > 30).reduce((a, p) => a + (p.saldo || 0), 0);
    const mayorDeuda = pend.length ? pend[0] : null;

    // Recurrentes sin facturar este mes (churn potencial)
    const sf = data.recurrentes_sin_facturar_mes;
    const recProm = new Map(data.clientes_recurrentes.map((c) => [c.cliente, c.promedio]));
    const mrrRiesgo = sf.reduce((a, c) => a + (recProm.get(c.cliente) || 0), 0);
    const catCount = new Map<string, number>();
    sf.forEach((c) => { const k = c.categoria || "sin_clasificar"; catCount.set(k, (catCount.get(k) || 0) + 1); });
    const catTop = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0] || null;

    // Top clientes
    const top5 = data.top_clientes.slice(0, 5);
    const top5Sum = top5.reduce((a, c) => a + (c.facturado || 0), 0);
    const revMes = data.comparativa_mes.actual?.facturado_total ?? data.kpis.facturado_mes;
    const concentracion = revMes > 0 ? (top5Sum / revMes) * 100 : 0;
    const principal = data.top_clientes.length ? data.top_clientes[0] : null;

    // ── Semáforos de salud comercial ──
    const cobRatio = data.kpis.facturado_mes > 0 ? data.kpis.cobrado_mes / data.kpis.facturado_mes : 1;
    const cxcShare = pendTotal > 0 ? vencido30 / pendTotal : 0;
    const totSubs = data.mrr.subs_activas + data.mrr.subs_canceladas;
    const churn = totSubs > 0 ? data.mrr.subs_canceladas / totSubs : 0;
    const sfShare = data.clientes_recurrentes.length > 0 ? sf.length / data.clientes_recurrentes.length : 0;
    const salud: { label: string; tone: Tone; detail: string }[] = [
      { label: "Facturación", tone: ritmoEstado.tone, detail: ritmoPct == null ? "—" : `${pct(ritmoPct)} vs ritmo` },
      { label: "Cobranza", tone: cobRatio >= 0.9 ? "emerald" : cobRatio >= 0.6 ? "amber" : "rose", detail: `${(cobRatio * 100).toFixed(0)}% cobrado` },
      { label: "Cuentas por cobrar", tone: cxcShare < 0.2 ? "emerald" : cxcShare <= 0.4 ? "amber" : "rose", detail: `${(cxcShare * 100).toFixed(0)}% +30d` },
      { label: "MRR", tone: churn < 0.05 ? "emerald" : churn <= 0.15 ? "amber" : "rose", detail: `${data.mrr.subs_canceladas} baja${data.mrr.subs_canceladas === 1 ? "" : "s"}` },
      { label: "Recurrentes sin facturar", tone: sf.length === 0 ? "emerald" : sfShare <= 0.25 ? "amber" : "rose", detail: `${sf.length} en riesgo` },
    ];

    return { isCurrent, daysInMonth, diaTrans, pctMes, ritmoPct, ritmoEstado, proyeccion,
      pend, pendTotal, vencido30, mayorDeuda, sf, mrrRiesgo, catTop, top5, concentracion, principal, salud };
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Gerencia</h1>
          <p className="text-sm text-slate-500">Tablero ejecutivo · ritmo, señales y tendencias</p>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-[#4FAEB2] focus:outline-none">
          {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </header>

      {error && <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">No se pudo cargar: {error}</div>}
      {loading && <div className="py-20 text-center text-slate-400">Cargando…</div>}

      {data && m && !loading && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Facturado del mes" value={gsShort(data.kpis.facturado_mes)} sub={pct(data.kpis.variacion_facturado_pct)} subColor={pctColor(data.kpis.variacion_facturado_pct)} accent />
            <Kpi label="Cobrado del mes" value={gsShort(data.kpis.cobrado_mes)} sub={pct(data.kpis.variacion_cobrado_pct)} subColor={pctColor(data.kpis.variacion_cobrado_pct)} />
            <Kpi label="Pendiente de cobro" value={gsShort(data.kpis.pendiente_cobro)} sub="cuentas por cobrar" />
            <Kpi label="MRR" value={gsShort(data.kpis.mrr)} sub={`${data.mrr.subs_activas} subs activas`} accent />
            <Kpi label="Ticket promedio" value={gsShort(data.kpis.ticket_promedio)} sub={`${data.kpis.facturas_mes} facturas`} />
            <Kpi label="Variación vs mes ant." value={pct(data.kpis.variacion_facturado_pct)} sub="facturado" subColor={pctColor(data.kpis.variacion_facturado_pct)} />
          </div>

          {/* Ritmo del mes + Salud comercial */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Ritmo del mes</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[m.ritmoEstado.tone].bg} ${TONE[m.ritmoEstado.tone].text}`}>{m.ritmoEstado.t}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Metric label="Día del mes" value={`${m.diaTrans} / ${m.daysInMonth}`} sub={`${m.pctMes.toFixed(0)}% transcurrido`} />
                <Metric label="Facturado a la fecha" value={gsShort(data.igual_dia.facturado_actual)} />
                <Metric label="A esta altura (mes ant.)" value={gsShort(data.igual_dia.facturado_anterior)} />
                <Metric label="Diferencia vs ritmo" value={gsShort(data.igual_dia.diff)} sub={pct(m.ritmoPct)} subColor={pctColor(m.ritmoPct)} />
                <Metric label="Proyección fin de mes" value={m.proyeccion == null ? "—" : gsShort(m.proyeccion)} sub={m.isCurrent ? "al ritmo actual" : "mes cerrado"} />
                <div className="self-end">
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[#4FAEB2]" style={{ width: `${Math.min(100, m.pctMes)}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">avance temporal del mes</div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Salud comercial</h2>
              <div className="space-y-2">
                {m.salud.map((s) => <Semaforo key={s.label} label={s.label} tone={s.tone} detail={s.detail} />)}
              </div>
            </div>
          </div>

          {/* Cards-resumen: Pendientes / Recurrentes en riesgo / Top clientes */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <SummaryCard title="Pendientes de cobro" tone={m.vencido30 > 0 ? "amber" : "slate"}>
              <Metric label="Facturas pendientes" value={String(m.pend.length)} />
              <Metric label="Monto total" value={gsShort(m.pendTotal)} />
              <Metric label="Vencido +30 días" value={gsShort(m.vencido30)} subColor={m.vencido30 > 0 ? "text-amber-600" : undefined} />
              <Metric label="Mayor deuda" value={m.mayorDeuda ? gsShort(m.mayorDeuda.saldo) : "—"} sub={m.mayorDeuda?.cliente} />
            </SummaryCard>
            <SummaryCard title="Recurrentes sin facturar" tone={m.sf.length > 0 ? "rose" : "emerald"}>
              <Metric label="Clientes en riesgo" value={String(m.sf.length)} />
              <Metric label="MRR estimado en riesgo" value={gsShort(m.mrrRiesgo)} subColor={m.mrrRiesgo > 0 ? "text-rose-600" : undefined} />
              <Metric label="Categoría más afectada" value={m.catTop ? (CAT_LABEL[m.catTop[0]] || m.catTop[0]) : "—"} sub={m.catTop ? `${m.catTop[1]} cliente${m.catTop[1] === 1 ? "" : "s"}` : undefined} />
            </SummaryCard>
            <SummaryCard title="Top clientes del mes" tone="slate">
              <Metric label="Cliente principal" value={m.principal ? m.principal.cliente : "—"} sub={m.principal ? gsShort(m.principal.facturado) : undefined} />
              <Metric label="Top 5 facturado" value={gsShort(m.top5.reduce((a, c) => a + c.facturado, 0))} />
              <Metric label="Concentración top 5" value={`${m.concentracion.toFixed(0)}%`} sub="del revenue del mes" subColor={m.concentracion >= 60 ? "text-amber-600" : undefined} />
            </SummaryCard>
          </div>

          {/* Tendencia + revenue por categoría */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Facturado vs Cobrado (tendencia)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.serie_mensual}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f5" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#64748b" }} />
                  <YAxis tickFormatter={(v) => gsShort(v)} tick={{ fontSize: 11, fill: "#94a3b8" }} width={70} />
                  <Tooltip formatter={(v: number) => gs(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="facturado_total" name="Facturado" fill={TEAL} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cobrado_total" name="Cobrado" fill="#a7d8db" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Revenue por categoría</h2>
              <CategoryBars rows={data.revenue_por_categoria} labelMap={CAT_LABEL} colorMap={CAT_COLOR} />
            </div>
          </div>

          {/* MRR por categoría */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">MRR por categoría</h2>
            <CategoryBars rows={data.mrr.por_categoria.map((mm) => ({ categoria: mm.categoria, facturado: mm.mrr, facturas: mm.subs_activas }))} unitLabel="subs" labelMap={CAT_LABEL} colorMap={CAT_COLOR} />
          </div>

          {/* Detalle secundario: tablas compactas (máx 5 filas) */}
          <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Detalle (resumen)</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Table title="Clientes recurrentes" cols={["Cliente", "Meses", "Prom.", "Categoría"]}
              rows={data.clientes_recurrentes.map((c) => [c.cliente, String(c.meses), gsShort(c.promedio), CAT_LABEL[c.categoria || "sin_clasificar"] || c.categoria || "—"])}
              total={data.clientes_recurrentes.length} empty="—" />
            <Table title="Pendientes de cobro" cols={["Cliente", "Factura", "Saldo", "Atraso"]}
              rows={data.pendientes_cobro.map((c) => [c.cliente, c.numero_factura || "—", gsShort(c.saldo), c.dias_atraso == null ? "—" : `${c.dias_atraso}d`])}
              total={data.pendientes_cobro.length} empty="Sin pendientes" />
          </div>
          <div className="mt-4">
            <Table title="Recurrentes SIN facturar este mes (alerta de churn)" cols={["Cliente", "Último mes", "Categoría"]}
              rows={data.recurrentes_sin_facturar_mes.map((c) => [c.cliente, c.ultimo, CAT_LABEL[c.categoria || "sin_clasificar"] || "—"])}
              total={data.recurrentes_sin_facturar_mes.length} empty="Todos los recurrentes facturaron este mes ✓" />
          </div>
          <p className="mt-4 text-xs text-slate-400">Moneda: Guaraníes (Gs). Anulación por estado de factura. Semáforos: heurística sobre los mismos datos (cobranza = cobrado/facturado; CxC = % vencido +30d; MRR = bajas de subs; recurrentes = clientes recurrentes sin factura este mes). Generado {new Date(data.generated_at).toLocaleString("es-PY")}.</p>
        </>
      )}
    </div>
  );
}
