"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import * as XLSX from "xlsx";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Info,
  PauseCircle,
  PackageCheck,
  Percent,
  RefreshCw,
  Timer,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { nombreCapitular, nombreCorto } from "@/lib/format/nombres";
import CountUp from "@/components/reactbits/CountUp";
import SpotlightCard from "@/components/reactbits/SpotlightCard";

const TEAL = "#4FAEB2";
const VERDE = "#22c55e";
const AMBAR = "#f5b544";
const ROJO = "#ef6461";

type Semaforo = "al_dia" | "en_riesgo" | "vencido";

type SlaData = {
  fecha_ref: string;
  fecha_desde: string | null;
  fecha_hasta: string;
  dias_riesgo: number;
  responsables_comercial: Opcion[];
  responsables_tecnico: Opcion[];
  monitoreados: number;
  cumplimiento_pct: number;
  vencidos: number;
  en_riesgo: number;
  al_dia: number;
  entregados: number;
  pausados: number;
  tiempo_respuesta_ms: number | null;
  tiempo_resolucion_ms: number | null;
  vs_ayer: {
    monitoreados: number;
    cumplimiento_pp: number;
    vencidos: number;
    en_riesgo: number;
    entregados: number;
    respuesta_ms: number | null;
    resolucion_ms: number | null;
  };
  por_estado: { estado_id: string; nombre: string; color: string; cantidad: number }[];
  por_tecnico: { usuario_id: string; nombre: string; total: number; cumplimiento_pct: number }[];
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

function fmtDur(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalMin = Math.round(Math.abs(ms) / 60000);
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

const SEMAFORO_META: Record<Semaforo, { label: string; color: string; pill: string }> = {
  al_dia: { label: "Al día", color: VERDE, pill: "bg-emerald-50 text-emerald-700" },
  en_riesgo: { label: "En riesgo", color: AMBAR, pill: "bg-amber-50 text-amber-700" },
  vencido: { label: "Vencido", color: ROJO, pill: "bg-rose-50 text-rose-700" },
};

/**
 * Etiqueta compacta del SLA, en una sola línea. El signo distingue vencido de
 * pendiente: sin él, "14 días" se leía igual estando vencido que faltando.
 */
function slaDiasLabel(dias: number | null): string {
  if (dias == null) return "—";
  if (dias === 0) return "Hoy";
  return dias < 0 ? `−${Math.abs(dias)}d` : `${dias}d`;
}

/** Título de tarjeta con el ícono de ayuda del diseño. */
function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <h2 className="text-[13px] font-semibold text-slate-700">{children}</h2>
        <Info className="h-3.5 w-3.5 text-slate-300" />
      </div>
      {right}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <SpotlightCard
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
      spotlightColor="rgba(79, 174, 178, 0.10)"
    >
      {children}
    </SpotlightCard>
  );
}

/** Píldora de filtro: etiqueta + valor dentro de la misma caja, como el diseño. */
function FiltroPill({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <span className="shrink-0 text-[13px] font-medium text-slate-600">{label}</span>
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Selector con la estética de la píldora del diseño: etiqueta y valor en la
 * misma caja, y un desplegable propio. Reemplaza al `<select>` nativo, que
 * mostraba una lista sin estilo, en mayúsculas y difícil de recorrer. Con más
 * de 8 opciones habilita un buscador.
 */
function PillSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Todos",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Opcion[];
  placeholder?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setAbierto(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierto(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [abierto]);

  const seleccionada = options.find((o) => o.id === value) ?? null;
  const buscable = options.length > 8;
  const filtradas = q.trim()
    ? options.filter((o) => o.nombre.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <span className="shrink-0 text-[13px] font-medium text-slate-600">{label}</span>
      <button
        type="button"
        onClick={() => {
          setAbierto((v) => !v);
          setQ("");
        }}
        className="flex min-w-0 flex-1 items-center justify-end gap-1 focus:outline-none"
        title={seleccionada?.nombre ?? placeholder}
      >
        <span className={`truncate text-[13px] ${seleccionada ? "text-slate-700" : "text-slate-400"}`}>
          {seleccionada ? seleccionada.nombre : placeholder}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`}
        />
      </button>

      {abierto ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {buscable ? (
            <div className="border-b border-slate-100 p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
          ) : null}
          <ul className="max-h-56 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setAbierto(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-slate-50 ${
                  !value ? "font-semibold text-[#2F6E71]" : "text-slate-600"
                }`}
              >
                {placeholder}
              </button>
            </li>
            {filtradas.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setAbierto(false);
                  }}
                  title={o.nombre}
                  className={`block w-full truncate px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-slate-50 ${
                    value === o.id ? "font-semibold text-[#2F6E71]" : "text-slate-600"
                  }`}
                >
                  {o.nombre}
                </button>
              </li>
            ))}
            {filtradas.length === 0 ? (
              <li className="px-3 py-2 text-center text-[11px] text-slate-400">Sin resultados</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type KpiTono = {
  circulo: string;
  icono: string;
};
const TONO: Record<string, KpiTono> = {
  teal: { circulo: "bg-[#4FAEB2]/12", icono: "text-[#4FAEB2]" },
  verde: { circulo: "bg-emerald-50", icono: "text-emerald-500" },
  rojo: { circulo: "bg-rose-50", icono: "text-rose-500" },
  ambar: { circulo: "bg-amber-50", icono: "text-amber-500" },
  azul: { circulo: "bg-sky-50", icono: "text-sky-500" },
  violeta: { circulo: "bg-violet-50", icono: "text-violet-500" },
};

/** KPI del diseño: círculo con ícono + etiqueta al lado, número grande y delta. */
function Kpi({
  icon: Icon,
  tono,
  label,
  numero,
  sufijo,
  texto,
  delta,
  deltaBueno,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tono: KpiTono;
  label: string;
  numero?: number;
  sufijo?: string;
  texto?: string;
  delta?: string | null;
  deltaBueno?: boolean;
}) {
  return (
    <Card>
      <div className="flex items-start gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tono.circulo}`}>
          <Icon className={`h-4 w-4 ${tono.icono}`} />
        </span>
        <span className="pt-0.5 text-[12px] leading-tight text-slate-500">{label}</span>
      </div>
      <div className="mt-2 text-[26px] font-bold leading-none tracking-tight text-slate-800">
        {numero != null ? <CountUp to={numero} separator="." duration={1} /> : texto}
        {sufijo}
      </div>
      {delta ? (
        <div className={`mt-1.5 text-[11px] font-medium ${deltaBueno ? "text-emerald-600" : "text-rose-500"}`}>
          {delta}
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] text-slate-300">—</div>
      )}
    </Card>
  );
}

function deltaTexto(valor: number, unidad: string): string | null {
  if (!Number.isFinite(valor) || valor === 0) return `Sin cambios vs. ayer`;
  const flecha = valor > 0 ? "↑" : "↓";
  return `${flecha} ${Math.abs(valor)}${unidad} vs. ayer`;
}

function deltaDuracion(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms === 0) return "Sin cambios vs. ayer";
  return `${ms > 0 ? "↑" : "↓"} ${fmtDur(ms)} vs. ayer`;
}

export default function SlaProyectosClient() {
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [desde, setDesde] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fRc, setFRc] = useState("");
  const [fRt, setFRt] = useState("");

  const [estados, setEstados] = useState<Opcion[]>([]);
  const [tipos, setTipos] = useState<Opcion[]>([]);

  const [data, setData] = useState<SlaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<Date | null>(null);

  // Estados y tipos salen de sus catálogos; los responsables vienen del propio
  // dashboard (separados por rol según su asignación real en proyectos).
  useEffect(() => {
    let cancel = false;
    (async () => {
      const [rEst, rTip] = await Promise.all([
        fetchWithSupabaseSession("/api/proyectos/estados", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/proyectos/tipos", { cache: "no-store" }),
      ]);
      const jEst = (await rEst.json().catch(() => ({}))) as { data?: Opcion[] };
      const jTip = (await rTip.json().catch(() => ({}))) as { data?: Opcion[] };
      if (cancel) return;
      setEstados(jEst.data ?? []);
      setTipos(jTip.data ?? []);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams();
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
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
  }, [desde, hasta, fEstado, fTipo, fRc, fRt]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const donut = useMemo(() => {
    if (!data) return [];
    return [
      { key: "al_dia", label: "Al día", value: data.al_dia, color: VERDE },
      { key: "en_riesgo", label: "En riesgo", value: data.en_riesgo, color: AMBAR },
      { key: "vencido", label: "Vencidos", value: data.vencidos, color: ROJO },
    ].filter((s) => s.value > 0);
  }, [data]);

  // Opciones de responsables, capitulares (el catálogo los guarda en MAYÚSCULAS).
  const comerciales = useMemo<Opcion[]>(
    () => (data?.responsables_comercial ?? []).map((o) => ({ id: o.id, nombre: nombreCapitular(o.nombre) })),
    [data?.responsables_comercial]
  );
  const tecnicos = useMemo<Opcion[]>(
    () => (data?.responsables_tecnico ?? []).map((o) => ({ id: o.id, nombre: nombreCapitular(o.nombre) })),
    [data?.responsables_tecnico]
  );

  // Nombres cortos para el eje del gráfico (los completos rompen el layout).
  const porTecnicoChart = useMemo(
    () => (data?.por_tecnico ?? []).slice(0, 5).map((t) => ({ ...t, corto: nombreCorto(t.nombre) })),
    [data?.por_tecnico]
  );

  const exportarExcel = useCallback(() => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Dashboard SLA — Proyectos"],
        ["Fecha de referencia", data.fecha_ref],
        [],
        ["Métrica", "Valor"],
        ["Proyectos monitoreados", data.monitoreados],
        ["% cumplimiento SLA", `${data.cumplimiento_pct}%`],
        ["Al día", data.al_dia],
        ["En riesgo", data.en_riesgo],
        ["Vencidos", data.vencidos],
        ["Entregados", data.entregados],
        ["Pausados", data.pausados],
        ["Tiempo prom. respuesta", fmtDur(data.tiempo_respuesta_ms)],
        ["Tiempo prom. resolución", fmtDur(data.tiempo_resolucion_ms)],
      ]),
      "Resumen"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Estado", "Cantidad"], ...data.por_estado.map((e) => [e.nombre, e.cantidad])]),
      "Por estado"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Responsable técnico", "% cumplimiento", "En curso"],
        ...data.por_tecnico.map((t) => [t.nombre, t.cumplimiento_pct, t.total]),
      ]),
      "Por técnico"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Proyecto", "Cliente", "Estado", "Resp. técnico", "Fecha prometida", "SLA", "Semáforo"],
        ...data.criticos.map((c) => [
          c.titulo,
          c.cliente,
          c.estado_nombre,
          c.responsable_tecnico,
          fmtFecha(c.fecha_prometida),
          slaDiasLabel(c.dias_restantes),
          SEMAFORO_META[c.semaforo].label,
        ]),
      ]),
      "Críticos"
    );
    XLSX.writeFile(wb, `SLA-Proyectos-${data.fecha_ref}.xlsx`);
  }, [data]);

  const exportarPdf = useCallback(() => {
    if (!data) return;
    const filaCrit = data.criticos
      .map(
        (c) => `<tr><td>${esc(c.titulo)}</td><td>${esc(c.cliente)}</td><td>${esc(c.estado_nombre)}</td>
        <td>${esc(c.responsable_tecnico)}</td><td>${fmtFecha(c.fecha_prometida)}</td>
        <td>${slaDiasLabel(c.dias_restantes)}</td>
        <td><span class="pill pill-${c.semaforo}">${SEMAFORO_META[c.semaforo].label}</span></td></tr>`
      )
      .join("");
    const filaTec = data.por_tecnico
      .map((t) => `<tr><td>${esc(t.nombre)}</td><td>${t.cumplimiento_pct}%</td><td>${t.total}</td></tr>`)
      .join("");
    const filaEst = data.por_estado.map((e) => `<tr><td>${esc(e.nombre)}</td><td>${e.cantidad}</td></tr>`).join("");
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
        th{text-align:left;color:#94a3b8;font-size:10px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;padding:6px}
        td{padding:6px;border-bottom:1px solid #f1f5f9}
        .pill{padding:2px 7px;border-radius:6px;font-weight:600;font-size:10px}
        .pill-al_dia{background:#ecfdf5;color:#047857} .pill-en_riesgo{background:#fffbeb;color:#b45309} .pill-vencido{background:#fff1f2;color:#be123c}
        @media print{body{margin:14mm}}
      </style></head><body>
      <div class="head">
        <div><div class="brand">NEURA · ERP</div><h1>Dashboard SLA — Proyectos</h1><div class="muted">Resumen diario para Directorio</div></div>
        <div class="muted">Fecha: ${data.fecha_ref}<br/>Generado: ${new Date().toLocaleString("es-PY")}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="v">${data.monitoreados}</div><div class="l">Proyectos monitoreados</div></div>
        <div class="kpi"><div class="v">${data.cumplimiento_pct}%</div><div class="l">% cumplimiento SLA</div></div>
        <div class="kpi"><div class="v">${data.vencidos}</div><div class="l">Vencidos</div></div>
        <div class="kpi"><div class="v">${data.en_riesgo}</div><div class="l">En riesgo</div></div>
        <div class="kpi"><div class="v">${data.entregados}</div><div class="l">Entregados</div></div>
        <div class="kpi"><div class="v">${fmtDur(data.tiempo_respuesta_ms)}</div><div class="l">Tiempo prom. respuesta</div></div>
        <div class="kpi"><div class="v">${fmtDur(data.tiempo_resolucion_ms)}</div><div class="l">Tiempo prom. resolución</div></div>
      </div>
      <h2>Proyectos críticos / próximos vencimientos</h2>
      <table><thead><tr><th>Proyecto</th><th>Cliente</th><th>Estado</th><th>Resp. técnico</th><th>Fecha prometida</th><th>SLA</th><th>Semáforo</th></tr></thead>
      <tbody>${filaCrit || '<tr><td colspan="7" class="muted">Sin críticos</td></tr>'}</tbody></table>
      <div style="display:flex;gap:24px;margin-top:8px">
        <div style="flex:1"><h2>Cumplimiento por responsable técnico</h2><table><thead><tr><th>Técnico</th><th>%</th><th>En curso</th></tr></thead><tbody>${filaTec || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody></table></div>
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
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#4FAEB2]" />
            <h1 className="text-[22px] font-bold tracking-tight text-slate-800">Dashboard SLA</h1>
          </div>
          <p className="ml-4 text-[13px] text-slate-400">Resumen diario para Directorio</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportarPdf}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:text-rose-600 disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
          <button
            type="button"
            onClick={exportarExcel}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:text-emerald-600 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <Database className="h-3.5 w-3.5 text-slate-400" />
            Fuente de datos: <span className="font-medium text-[#4FAEB2]">Módulo Proyectos</span>
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
        <PillSelect label="Estado" value={fEstado} onChange={setFEstado} options={estados} />
        <PillSelect label="Tipo" value={fTipo} onChange={setFTipo} options={tipos} />
        <PillSelect label="Resp. comercial" value={fRc} onChange={setFRc} options={comerciales} />
        <PillSelect label="Resp. técnico" value={fRt} onChange={setFRt} options={tecnicos} />
      </div>

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{err}</div> : null}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-[118px] animate-pulse rounded-xl border border-slate-200 bg-slate-100/70" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <Kpi
              icon={FolderOpen}
              tono={TONO.teal}
              label="Proyectos monitoreados"
              numero={data.monitoreados}
              delta={deltaTexto(data.vs_ayer.monitoreados, "")}
              deltaBueno={data.vs_ayer.monitoreados >= 0}
            />
            <Kpi
              icon={Percent}
              tono={TONO.verde}
              label="% cumplimiento SLA"
              numero={data.cumplimiento_pct}
              sufijo="%"
              delta={deltaTexto(data.vs_ayer.cumplimiento_pp, " pp")}
              deltaBueno={data.vs_ayer.cumplimiento_pp >= 0}
            />
            <Kpi
              icon={AlertCircle}
              tono={TONO.rojo}
              label="Vencidos"
              numero={data.vencidos}
              delta={deltaTexto(data.vs_ayer.vencidos, "")}
              deltaBueno={data.vs_ayer.vencidos <= 0}
            />
            <Kpi
              icon={AlertTriangle}
              tono={TONO.ambar}
              label="En riesgo"
              numero={data.en_riesgo}
              delta={deltaTexto(data.vs_ayer.en_riesgo, "")}
              deltaBueno={data.vs_ayer.en_riesgo <= 0}
            />
            <Kpi
              icon={PackageCheck}
              tono={TONO.teal}
              label="Entregados"
              numero={data.entregados}
              delta={deltaTexto(data.vs_ayer.entregados, "")}
              deltaBueno={data.vs_ayer.entregados >= 0}
            />
            <Kpi
              icon={Clock}
              tono={TONO.azul}
              label="Tiempo prom. respuesta"
              texto={fmtDur(data.tiempo_respuesta_ms)}
              delta={deltaDuracion(data.vs_ayer.respuesta_ms)}
              deltaBueno={(data.vs_ayer.respuesta_ms ?? 0) <= 0}
            />
            <Kpi
              icon={Timer}
              tono={TONO.violeta}
              label="Tiempo prom. resolución"
              texto={fmtDur(data.tiempo_resolucion_ms)}
              delta={deltaDuracion(data.vs_ayer.resolucion_ms)}
              deltaBueno={(data.vs_ayer.resolucion_ms ?? 0) <= 0}
            />
          </div>

          {/* Gráficos: 3 en una fila */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {/* Semáforo SLA */}
            <Card>
              <CardTitle>Semáforo SLA</CardTitle>
              {donut.length === 0 ? (
                <p className="text-sm text-slate-400">Sin datos</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="h-[128px] w-[128px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donut}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={38}
                            outerRadius={61}
                            paddingAngle={1}
                            strokeWidth={0}
                            labelLine={false}
                            label={renderPorcentaje}
                          >
                            {donut.map((s) => (
                              <Cell key={s.key} fill={s.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number, n) => [`${v} proyectos`, String(n)]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {donut.map((s) => (
                        <div key={s.key} className="flex items-center gap-1.5 text-[10px] whitespace-nowrap">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                          <span className="text-slate-500">{s.label}</span>
                          <span className="ml-auto whitespace-nowrap font-medium tabular-nums text-slate-600">
                            {s.value} ({data.monitoreados > 0 ? Math.round((s.value / data.monitoreados) * 100) : 0}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                    Total: {data.monitoreados} proyectos
                  </div>
                </>
              )}
            </Card>

            {/* Cumplimiento por responsable técnico */}
            <Card>
              <CardTitle>Cumplimiento por responsable técnico</CardTitle>
              {data.por_tecnico.length === 0 ? (
                <p className="text-sm text-slate-400">Sin datos</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={168}>
                    <BarChart
                      data={porTecnicoChart}
                      layout="vertical"
                      margin={{ left: 0, right: 36, top: 10, bottom: 0 }}
                      barCategoryGap="28%"
                    >
                      <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        tick={{ fontSize: 9, fill: "#94a3b8" }}
                        tickFormatter={(v) => `${v}%`}
                        axisLine={false}
                        tickLine={false}
                      />
                      {/* Nombre corto en UNA línea: con el nombre completo el texto
                          se partía en tres renglones y el primero quedaba cortado. */}
                      <YAxis
                        type="category"
                        dataKey="corto"
                        width={92}
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <Tooltip formatter={(v: number) => [`${v}%`, "Cumplimiento"]} />
                      <ReferenceLine x={90} stroke="#cbd5e1" strokeDasharray="3 3" />
                      <Bar dataKey="cumplimiento_pct" fill={TEAL} radius={[0, 3, 3, 0]} barSize={12}>
                        <LabelList
                          dataKey="cumplimiento_pct"
                          position="right"
                          formatter={(v: number) => `${v}%`}
                          style={{ fontSize: 10, fill: "#475569", fontWeight: 600 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
                    <span className="inline-block h-px w-5 border-t border-dashed border-slate-400" />
                    Objetivo: 90%
                  </div>
                </>
              )}
            </Card>

            {/* Proyectos por estado */}
            <Card>
              <CardTitle>Proyectos por estado</CardTitle>
              {data.por_estado.length === 0 ? (
                <p className="text-sm text-slate-400">Sin datos</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={168}>
                    <BarChart data={data.por_estado} margin={{ top: 16, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#f1f5f9" />
                      {/* Sin etiquetas en el eje: con 6 estados de nombre largo
                          se encimaban unas sobre otras, y la leyenda de abajo ya
                          identifica cada barra por color. */}
                      <XAxis dataKey="nombre" tick={false} axisLine={false} tickLine={false} height={4} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => [`${v} proyectos`, "Cantidad"]} />
                      <Bar dataKey="cantidad" radius={[3, 3, 0, 0]} barSize={26}>
                        <LabelList
                          dataKey="cantidad"
                          position="top"
                          style={{ fontSize: 10, fill: "#475569", fontWeight: 700 }}
                        />
                        {data.por_estado.map((e) => (
                          <Cell key={e.estado_id} fill={e.color || TEAL} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-1 flex flex-wrap justify-center gap-x-2.5 gap-y-1">
                    {data.por_estado.map((e) => (
                      <span key={e.estado_id} className="flex items-center gap-1 text-[9px] text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color || TEAL }} />
                        {e.nombre}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* Inferior: críticos + alertas */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <CardTitle>Proyectos críticos / próximos vencimientos</CardTitle>
                {data.criticos.length === 0 ? (
                  <p className="text-sm text-slate-400">No hay proyectos críticos en este momento.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full table-auto text-[12px]">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 [&>th]:whitespace-nowrap [&>th]:pb-2 [&>th]:font-medium">
                          <th>Proyecto</th>
                          <th>Cliente</th>
                          <th>Estado</th>
                          <th>Resp. técnico</th>
                          <th>Fecha prometida</th>
                          <th>SLA</th>
                          <th>Semáforo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.criticos.slice(0, 5).map((c) => {
                          const meta = SEMAFORO_META[c.semaforo];
                          const tecnico = nombreCorto(c.responsable_tecnico);
                          return (
                            <tr key={c.id} className="align-middle text-slate-600 [&>td]:py-2.5">
                              <td className="max-w-[150px] truncate font-medium text-slate-700" title={c.titulo}>
                                {c.titulo}
                              </td>
                              <td className="max-w-[140px] truncate text-slate-500" title={c.cliente}>
                                {c.cliente}
                              </td>
                              <td>
                                <span
                                  className="inline-block max-w-[130px] truncate whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium"
                                  style={{ background: `${c.estado_color}1f`, color: c.estado_color }}
                                  title={c.estado_nombre}
                                >
                                  {c.estado_nombre}
                                </span>
                              </td>
                              <td className="whitespace-nowrap" title={c.responsable_tecnico}>
                                {tecnico}
                              </td>
                              <td className="whitespace-nowrap tabular-nums">{fmtFecha(c.fecha_prometida)}</td>
                              <td>
                                <span
                                  className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ${meta.pill}`}
                                  title={
                                    c.dias_restantes != null && c.dias_restantes < 0
                                      ? `Vencido hace ${Math.abs(c.dias_restantes)} día(s)`
                                      : "Días hasta la fecha prometida"
                                  }
                                >
                                  {slaDiasLabel(c.dias_restantes)}
                                </span>
                              </td>
                              <td>
                                <span
                                  className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]"
                                  style={{ color: meta.color }}
                                >
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                                  {meta.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="mt-3 border-t border-slate-100 pt-2 text-center">
                      <Link
                        href="/dashboard/proyectos"
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-[#4FAEB2] hover:underline"
                      >
                        Ver todos los proyectos <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            <Card>
              <CardTitle
                right={
                  <Link href="/dashboard/proyectos" className="text-[11px] font-medium text-[#4FAEB2] hover:underline">
                    Ver todas
                  </Link>
                }
              >
                Alertas de hoy
              </CardTitle>
              <div className="divide-y divide-slate-100">
                <AlertaFila
                  icon={AlertCircle}
                  color="text-rose-500"
                  bg="bg-rose-50"
                  titulo={`${data.vencidos} proyectos vencidos`}
                  detalle="Requieren atención inmediata."
                />
                <AlertaFila
                  icon={AlertTriangle}
                  color="text-amber-500"
                  bg="bg-amber-50"
                  titulo={`${data.en_riesgo} proyectos en riesgo`}
                  detalle="Pueden incumplir la fecha prometida."
                />
                <AlertaFila
                  icon={PauseCircle}
                  color="text-sky-500"
                  bg="bg-sky-50"
                  titulo={`${data.pausados} proyectos pausados`}
                  detalle="Esperando datos del cliente."
                />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                <span>
                  Última actualización:{" "}
                  {actualizado
                    ? `hoy ${actualizado.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}`
                    : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => void cargar()}
                  className="rounded p-1 text-slate-400 transition-colors hover:text-[#4FAEB2]"
                  title="Actualizar"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AlertaFila({
  icon: Icon,
  color,
  bg,
  titulo,
  detalle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  titulo: string;
  detalle: string;
}) {
  return (
    <Link href="/dashboard/proyectos" className="flex items-center gap-2.5 py-2.5 transition-colors hover:bg-slate-50/70">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${bg}`}>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-slate-700">{titulo}</span>
        <span className="block text-[11px] text-slate-400">{detalle}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </Link>
  );
}

/** Porcentaje dibujado sobre cada gajo del donut (como el diseño). */
function renderPorcentaje(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
}) {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0 } = props;
  if (percent < 0.06) return <g />;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {`${Math.round(percent * 100)}%`}
    </text>
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
