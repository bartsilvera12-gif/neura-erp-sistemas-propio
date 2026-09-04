"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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
import * as XLSX from "xlsx";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileText,
  Gauge,
  Layers3,
  PauseCircle,
  RefreshCw,
  Timer,
  Zap,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import CountUp from "@/components/reactbits/CountUp";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import BlurText from "@/components/reactbits/BlurText";

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

type Tono = { badge: string; ring: string; sub: string; spot: `rgba(${number}, ${number}, ${number}, ${number})` };
const TONO: Record<string, Tono> = {
  teal: { badge: "bg-[#4FAEB2]/12 text-[#2F6E71]", ring: "border-[#4FAEB2]/30", sub: "text-slate-400", spot: "rgba(79, 174, 178, 0.16)" },
  emerald: { badge: "bg-emerald-50 text-emerald-600", ring: "border-emerald-200", sub: "text-emerald-600", spot: "rgba(16, 185, 129, 0.16)" },
  rose: { badge: "bg-rose-50 text-rose-600", ring: "border-rose-200", sub: "text-rose-600", spot: "rgba(244, 63, 94, 0.16)" },
  amber: { badge: "bg-amber-50 text-amber-600", ring: "border-amber-200", sub: "text-amber-600", spot: "rgba(245, 158, 11, 0.16)" },
  indigo: { badge: "bg-indigo-50 text-indigo-600", ring: "border-indigo-200", sub: "text-slate-400", spot: "rgba(99, 102, 241, 0.16)" },
  violet: { badge: "bg-violet-50 text-violet-600", ring: "border-violet-200", sub: "text-slate-400", spot: "rgba(139, 92, 246, 0.16)" },
};

const fade = (i = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay: i * 0.05, ease: "easeOut" as const },
});

function KpiCard({
  icon: Icon,
  label,
  tono,
  numero,
  sufijo,
  texto,
  sub,
  index,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tono: Tono;
  numero?: number;
  sufijo?: string;
  texto?: string;
  sub?: string;
  index: number;
}) {
  return (
    <motion.div {...fade(index)}>
      <SpotlightCard
        className={`rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${tono.ring}`}
        spotlightColor={tono.spot}
      >
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tono.badge}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="mt-3 flex items-end gap-0.5 text-3xl font-extrabold tracking-tight text-slate-800">
          {numero != null ? <CountUp to={numero} separator="." duration={1.1} /> : <span>{texto}</span>}
          {sufijo ? <span className="pb-0.5 text-xl font-bold">{sufijo}</span> : null}
        </div>
        <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
        {sub ? <div className={`mt-0.5 text-xs ${tono.sub}`}>{sub}</div> : null}
      </SpotlightCard>
    </motion.div>
  );
}

function Panel({ title, children, index, right }: { title: string; children: React.ReactNode; index: number; right?: React.ReactNode }) {
  return (
    <motion.div {...fade(index)}>
      <SpotlightCard className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm" spotlightColor="rgba(79, 174, 178, 0.10)">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {right}
        </div>
        {children}
      </SpotlightCard>
    </motion.div>
  );
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
  const [actualizado, setActualizado] = useState<Date | null>(null);

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
      setUsuarios((jUsers.usuarios ?? []).map((u) => ({ id: u.id, nombre: (u.nombre ?? "").trim() || u.email || "—" })));
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
    const res = await fetchWithSupabaseSession(`/api/proyectos/sla-dashboard?${sp.toString()}`, { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { success?: boolean; data?: SlaData; error?: string };
    if (!res.ok || !j.success || !j.data) {
      setErr(j.error ?? "No se pudo cargar el dashboard");
      setLoading(false);
      return;
    }
    setData(j.data);
    setActualizado(new Date());
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

  // ---- Exportaciones ----
  const exportarExcel = useCallback(() => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const resumen = [
      ["Dashboard SLA — Proyectos", ""],
      ["Fecha de referencia", data.fecha_ref],
      ["", ""],
      ["Métrica", "Valor"],
      ["Proyectos monitoreados", data.monitoreados],
      ["% cumplimiento SLA", `${data.cumplimiento_pct}%`],
      ["Al día", data.al_dia],
      ["En riesgo", data.en_riesgo],
      ["Vencidos", data.vencidos],
      ["Pausados", data.pausados],
      ["Tiempo prom. respuesta", fmtDur(data.tiempo_respuesta_ms)],
      ["Tiempo prom. resolución", fmtDur(data.tiempo_resolucion_ms)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), "Resumen");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Estado", "Cantidad"], ...data.por_estado.map((e) => [e.nombre, e.cantidad])]),
      "Por estado"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Responsable técnico", "% cumplimiento", "En curso"], ...data.por_tecnico.map((t) => [t.nombre, t.cumplimiento_pct, t.total])]),
      "Por técnico"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Proyecto", "Cliente", "Estado", "Resp. técnico", "Fecha prometida", "SLA (días)", "Semáforo"],
        ...data.criticos.map((c) => [
          c.titulo,
          c.cliente,
          c.estado_nombre,
          c.responsable_tecnico,
          fmtFecha(c.fecha_prometida),
          c.dias_restantes ?? "",
          SEMAFORO_META[c.semaforo].label,
        ]),
      ]),
      "Críticos"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Fecha", "% cumplimiento"], ...data.tendencia.map((t) => [t.fecha, t.cumplimiento_pct])]),
      "Tendencia"
    );
    XLSX.writeFile(wb, `SLA-Proyectos-${data.fecha_ref}.xlsx`);
  }, [data]);

  const exportarPdf = useCallback(() => {
    if (!data) return;
    const filaCrit = data.criticos
      .map(
        (c) => `<tr>
          <td>${esc(c.titulo)}</td><td>${esc(c.cliente)}</td><td>${esc(c.estado_nombre)}</td>
          <td>${esc(c.responsable_tecnico)}</td><td>${fmtFecha(c.fecha_prometida)}</td>
          <td>${slaDiasLabel(c.dias_restantes)}</td>
          <td><span class="pill pill-${c.semaforo}">${SEMAFORO_META[c.semaforo].label}</span></td>
        </tr>`
      )
      .join("");
    const filaTec = data.por_tecnico
      .map((t) => `<tr><td>${esc(t.nombre)}</td><td>${t.cumplimiento_pct}%</td><td>${t.total}</td></tr>`)
      .join("");
    const filaEst = data.por_estado
      .map((e) => `<tr><td>${esc(e.nombre)}</td><td>${e.cantidad}</td></tr>`)
      .join("");
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
      <title>SLA Proyectos ${data.fecha_ref}</title>
      <style>
        *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;margin:32px;font-size:12px}
        h1{font-size:20px;margin:0} .muted{color:#64748b;font-size:12px}
        .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #4FAEB2;padding-bottom:10px;margin-bottom:16px}
        .brand{color:#2F6E71;font-weight:800;letter-spacing:.5px}
        .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}
        .kpi{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
        .kpi .v{font-size:20px;font-weight:800} .kpi .l{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8}
        h2{font-size:13px;margin:18px 0 6px} table{width:100%;border-collapse:collapse;font-size:11px}
        th{text-align:left;color:#94a3b8;font-size:10px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding:6px 6px}
        td{padding:6px 6px;border-bottom:1px solid #f1f5f9}
        .pill{padding:2px 7px;border-radius:6px;font-weight:600;font-size:10px}
        .pill-al_dia{background:#ecfdf5;color:#047857} .pill-en_riesgo{background:#fffbeb;color:#b45309} .pill-vencido{background:#fff1f2;color:#be123c}
        @media print{body{margin:14mm}}
      </style></head><body>
      <div class="head">
        <div><div class="brand">NEURA · ERP</div><h1>Dashboard SLA — Proyectos</h1></div>
        <div class="muted">Fecha: ${data.fecha_ref}<br/>Generado: ${new Date().toLocaleString("es-PY")}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="v">${data.monitoreados}</div><div class="l">Monitoreados</div></div>
        <div class="kpi"><div class="v">${data.cumplimiento_pct}%</div><div class="l">Cumplimiento SLA</div></div>
        <div class="kpi"><div class="v">${data.vencidos}</div><div class="l">Vencidos</div></div>
        <div class="kpi"><div class="v">${data.en_riesgo}</div><div class="l">En riesgo</div></div>
        <div class="kpi"><div class="v">${fmtDur(data.tiempo_respuesta_ms)}</div><div class="l">Prom. respuesta</div></div>
        <div class="kpi"><div class="v">${fmtDur(data.tiempo_resolucion_ms)}</div><div class="l">Prom. resolución</div></div>
      </div>
      <h2>Proyectos críticos / próximos vencimientos</h2>
      <table><thead><tr><th>Proyecto</th><th>Cliente</th><th>Estado</th><th>Resp. técnico</th><th>Fecha prometida</th><th>SLA</th><th>Semáforo</th></tr></thead><tbody>${filaCrit || '<tr><td colspan="7" class="muted">Sin críticos</td></tr>'}</tbody></table>
      <div style="display:flex;gap:24px;margin-top:8px">
        <div style="flex:1"><h2>Cumplimiento por técnico</h2><table><thead><tr><th>Técnico</th><th>%</th><th>En curso</th></tr></thead><tbody>${filaTec || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody></table></div>
        <div style="flex:1"><h2>Proyectos por estado</h2><table><thead><tr><th>Estado</th><th>Cantidad</th></tr></thead><tbody>${filaEst || '<tr><td colspan="2" class="muted">—</td></tr>'}</tbody></table></div>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Cabecera */}
      <motion.div {...fade(0)} className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4FAEB2] opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#4FAEB2]" />
            </span>
            <BlurText text="Dashboard SLA" className="text-2xl font-extrabold tracking-tight text-slate-800" animateBy="words" />
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            Cumplimiento de SLA de proyectos en tiempo real.
            {actualizado ? <span className="text-slate-400"> · Actualizado {actualizado.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 shadow-sm sm:inline-flex">
            <Database className="h-3.5 w-3.5 text-[#4FAEB2]" />
            Fuente: <span className="font-semibold text-slate-700">Módulo Proyectos</span>
          </span>
          <button
            type="button"
            onClick={() => void cargar()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]"
            title="Actualizar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            type="button"
            onClick={exportarPdf}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </button>
          <button
            type="button"
            onClick={exportarExcel}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </button>
        </div>
      </motion.div>

      {/* Filtros */}
      <motion.div {...fade(1)} className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200/80 bg-white/70 p-4 shadow-sm backdrop-blur sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className={labelCls}>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Estado</label>
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {estados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Tipo</label>
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Resp. comercial</label>
          <select value={fRc} onChange={(e) => setFRc(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Resp. técnico</label>
          <select value={fRt} onChange={(e) => setFRt(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
      </motion.div>

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{err}</div> : null}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100/70" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard index={0} icon={Layers3} tono={TONO.teal} label="Monitoreados" numero={data.monitoreados} sub="Proyectos activos" />
            <KpiCard
              index={1}
              icon={Gauge}
              tono={data.cumplimiento_pct >= 90 ? TONO.emerald : data.cumplimiento_pct >= 75 ? TONO.amber : TONO.rose}
              label="Cumplimiento SLA"
              numero={data.cumplimiento_pct}
              sufijo="%"
              sub={data.cumplimiento_pct >= 90 ? "Objetivo cumplido" : "Bajo objetivo (90%)"}
            />
            <KpiCard index={2} icon={AlertOctagon} tono={TONO.rose} label="Vencidos" numero={data.vencidos} sub="Atención inmediata" />
            <KpiCard index={3} icon={AlertTriangle} tono={TONO.amber} label="En riesgo" numero={data.en_riesgo} sub={`Vence en ≤ ${data.dias_riesgo}d`} />
            <KpiCard index={4} icon={Zap} tono={TONO.indigo} label="Prom. respuesta" texto={fmtDur(data.tiempo_respuesta_ms)} sub="Hasta el 1er movimiento" />
            <KpiCard index={5} icon={Timer} tono={TONO.violet} label="Prom. resolución" texto={fmtDur(data.tiempo_resolucion_ms)} sub="Ingreso → 1ª entrega" />
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Semáforo SLA" index={6}>
              {donut.length === 0 ? (
                <p className="text-sm text-slate-400">Sin datos</p>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <div className="relative h-[190px] w-[190px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={donut} dataKey="value" nameKey="label" innerRadius={62} outerRadius={88} paddingAngle={2} strokeWidth={0} isAnimationActive>
                          {donut.map((s) => <Cell key={s.key} fill={s.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: number, n) => [`${v} proyectos`, String(n)]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-extrabold text-slate-800">
                        <CountUp to={data.cumplimiento_pct} duration={1.2} />%
                      </span>
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
                    <div className="border-t border-slate-100 pt-2 text-xs text-slate-400">Total: {data.monitoreados} proyectos</div>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Cumplimiento por responsable técnico" index={7}>
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
                        <Cell key={t.usuario_id} fill={t.cumplimiento_pct >= 90 ? COLOR_ALDIA : t.cumplimiento_pct >= 75 ? COLOR_RIESGO : COLOR_VENCIDO} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>

            <Panel title="Proyectos por estado" index={8}>
              {data.por_estado.length === 0 ? (
                <p className="text-sm text-slate-400">Sin datos</p>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={data.por_estado} margin={{ top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f5" />
                    <XAxis dataKey="nombre" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} width={30} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => [`${v} proyectos`, "Cantidad"]} />
                    <Bar dataKey="cantidad" radius={[4, 4, 0, 0]}>
                      {data.por_estado.map((e) => <Cell key={e.estado_id} fill={e.color || TEAL} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>

            <Panel title="Tendencia de cumplimiento (últimos 7 días)" index={9}>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={data.tendencia} margin={{ top: 8, right: 12 }}>
                  <defs>
                    <linearGradient id="slaLine" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#4FAEB2" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f5" />
                  <XAxis dataKey="fecha" tickFormatter={fmtDiaCorto} tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} width={34} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => [`${v}%`, "Cumplimiento"]} labelFormatter={(l) => fmtDiaCorto(String(l))} />
                  <ReferenceLine y={90} stroke="#cbd5e1" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="cumplimiento_pct" stroke="url(#slaLine)" strokeWidth={3} dot={{ r: 3, fill: TEAL }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {/* Paneles inferiores */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel
                title="Proyectos críticos / próximos vencimientos"
                index={10}
                right={
                  <Link href="/dashboard/proyectos" className="text-xs font-medium text-[#4FAEB2] hover:underline">
                    Ver todos →
                  </Link>
                }
              >
                {data.criticos.length === 0 ? (
                  <p className="text-sm text-slate-400">No hay proyectos críticos en este momento. 🎉</p>
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
                            <tr key={c.id} className="text-slate-600 transition-colors hover:bg-slate-50/70">
                              <td className="py-1.5 font-medium text-slate-700">{c.titulo}</td>
                              <td className="py-1.5">{c.cliente}</td>
                              <td className="py-1.5">
                                <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: `${c.estado_color}1a`, color: c.estado_color }}>
                                  {c.estado_nombre}
                                </span>
                              </td>
                              <td className="py-1.5">{c.responsable_tecnico}</td>
                              <td className="py-1.5">{fmtFecha(c.fecha_prometida)}</td>
                              <td className="py-1.5">
                                <span className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${meta.badge}`}>{slaDiasLabel(c.dias_restantes)}</span>
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
                  </div>
                )}
              </Panel>
            </div>

            <Panel title="Alertas de hoy" index={11}>
              <div className="space-y-2.5">
                <Link href="/dashboard/proyectos" className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 transition-colors hover:bg-rose-100/60">
                  <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                  <div>
                    <p className="text-sm font-semibold text-rose-700">
                      <CountUp to={data.vencidos} /> proyectos vencidos
                    </p>
                    <p className="text-xs text-rose-600/80">Requieren atención inmediata.</p>
                  </div>
                </Link>
                <Link href="/dashboard/proyectos" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 transition-colors hover:bg-amber-100/60">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-amber-700">
                      <CountUp to={data.en_riesgo} /> proyectos en riesgo
                    </p>
                    <p className="text-xs text-amber-600/80">Pueden incumplir la fecha prometida.</p>
                  </div>
                </Link>
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      <CountUp to={data.pausados} /> proyectos pausados
                    </p>
                    <p className="text-xs text-slate-500">Esperando datos del cliente o en pausa.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">
                      <CountUp to={data.al_dia} /> proyectos al día
                    </p>
                    <p className="text-xs text-emerald-600/80">Dentro del plazo comprometido.</p>
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
