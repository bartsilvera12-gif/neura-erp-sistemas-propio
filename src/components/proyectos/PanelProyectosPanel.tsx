"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Panel = {
  kpis: {
    total: number;
    en_curso: number;
    entregados_mes: number;
    entregados_mes_monto: number;
    presupuesto_total: number;
    con_presupuesto: number;
    ticket_promedio: number;
    sla_vencidos: number;
  };
  por_estado: {
    estado: string;
    es_final: boolean;
    cantidad: number;
    presupuesto: number;
    sla_vencidos: number;
    sla_configurado: boolean;
  }[];
  por_asesor: { asesor: string; cantidad: number; presupuesto: number; proyectos: DetalleProy[] }[];
  por_tecnico: { tecnico: string; cantidad: number; presupuesto: number; proyectos: DetalleProy[] }[];
  por_tipo: { tipo: string; cantidad: number; presupuesto: number }[];
  por_rubro: { rubro: string; cantidad: number }[];
  entregados_por_mes: EntregadosMes[];
  periodo_ym: string;
  periodo_filtrado?: boolean;
  periodo_desde?: string;
  periodo_hasta?: string;
};

function fmtFecha(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

type DetalleProy = {
  id: string;
  titulo: string;
  cliente: string;
  estado: string;
  estado_orden: number;
  es_final: boolean;
  vendedor: string;
  presupuesto: number;
  dias_en_estado: number | null;
  sla_vencido: boolean;
  sla_texto: string;
};

type EntregaProy = { id: string; titulo: string; cliente: string; monto: number; fecha: string | null; tipo: string };
type ResumenTipoMes = { cantidad: number; monto: number; proyectos: EntregaProy[] };
type EntregadosMes = ResumenTipoMes & {
  ym: string;
  /** Exclusivos entre sí: web.cantidad + saas.cantidad + mixto.cantidad === cantidad. */
  web: ResumenTipoMes;
  saas: ResumenTipoMes;
  mixto: ResumenTipoMes;
};

/**
 * Degradés de "Entregados por mes": cada barra va de un tinte claro arriba a
 * su color validado abajo, y el color validado es siempre el stop de mayor
 * peso (el que ancla contraste e identidad) — el degradé es hondura dentro
 * del MISMO tono, nunca una mezcla hacia el otro color de la serie. Reusa
 * tokens que ya existen en la app (el teal claro/oscuro de marca, los pasos
 * de Tailwind violet/slate) en vez de inventar hex nuevos.
 */
const GRADIENTE_WEB = "linear-gradient(180deg, #4FAEB2 0%, #3F8E91 100%)";
const GRADIENTE_WEB_ACTIVO = "linear-gradient(180deg, #3F8E91 0%, #2F6E71 100%)";
const GRADIENTE_SAAS = "linear-gradient(180deg, #a78bfa 0%, #8b5cf6 100%)";
const GRADIENTE_SAAS_ACTIVO = "linear-gradient(180deg, #8b5cf6 0%, #6d28d9 100%)";
const GRADIENTE_MIXTO = "linear-gradient(180deg, #cbd5e1 0%, #94a3b8 100%)";
const GRADIENTE_MIXTO_ACTIVO = "linear-gradient(180deg, #94a3b8 0%, #64748b 100%)";

function fmtGs(n: number): string {
  return `₲ ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(n || 0)}`;
}

/** Tabla de proyectos de un responsable (etapa, vendedor, presupuesto, SLA). */
function ProyectosDetalleTabla({ proyectos, mostrarVendedor = false }: { proyectos: DetalleProy[]; mostrarVendedor?: boolean }) {
  if (!proyectos.length) return <p className="px-3 py-3 text-xs text-slate-400">Sin proyectos.</p>;
  const cols = mostrarVendedor
    ? ["Cliente / Proyecto", "Etapa", "Vendedor", "Presupuesto", "SLA"]
    : ["Cliente / Proyecto", "Etapa", "Presupuesto", "SLA"];
  const rightFrom = mostrarVendedor ? 3 : 2;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-slate-100 bg-slate-50/60">
          <tr>
            {cols.map((h, i) => (
              <th key={i} className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ${i >= rightFrom ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {proyectos.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50/60">
              <td className="px-3 py-2">
                <span className="block font-medium text-slate-800">{p.cliente}</span>
                {p.titulo && p.titulo !== p.cliente ? <span className="block text-[11px] text-slate-400">{p.titulo}</span> : null}
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2 py-0.5 text-[11px] font-semibold text-[#3F8E91]">
                  {p.estado}
                </span>
              </td>
              {mostrarVendedor ? (
                <td className="whitespace-nowrap px-3 py-2 text-[12px] text-slate-600">{p.vendedor}</td>
              ) : null}
              <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-[#3F8E91]">
                {p.presupuesto > 0 ? fmtGs(p.presupuesto) : <span className="text-slate-300">—</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-[11px]">
                <span className={p.sla_vencido ? "font-semibold text-rose-600" : "text-slate-400"}>{p.sla_texto}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {proyectos.some((p) => p.presupuesto <= 0) ? (
        <p className="px-3 py-1.5 text-[10px] text-slate-400">
          &quot;—&quot; = sin presupuesto atribuido (cliente sin factura, o ya contado en otro proyecto del mismo
          cliente).
        </p>
      ) : null}
    </div>
  );
}
function mesLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const mi = parseInt(m ?? "", 10);
  return `${meses[mi - 1] ?? m} ${(y ?? "").slice(2)}`;
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "danger" | "money" | "ok" }) {
  const color =
    accent === "danger" ? "text-rose-700" : accent === "money" ? "text-[#3F8E91]" : accent === "ok" ? "text-emerald-700" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function Bar({ value, max, className = "bg-[#4FAEB2]" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-slate-100">
      <div className={`h-2 rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Contenido del panel gerencial de proyectos (KPIs + secciones). Sin encabezado de página.
 * Muestra TODO el universo de proyectos no archivados (sin filtro por mes) para organizar al equipo.
 */
export default function PanelProyectosPanel() {
  const [data, setData] = useState<Panel | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mesSel, setMesSel] = useState<string | null>(null); // ym del histórico abierto
  /**
   * Arranca en `false` a propósito: las barras de "Entregados por mes" pintan
   * su primer frame en altura 0 y recién después suben a su altura real, para
   * que la animación de entrada tenga desde dónde partir. Sin este paso extra
   * React pintaría la altura final de una, sin nada que animar.
   */
  const [barrasMontadas, setBarrasMontadas] = useState(false);
  const [aseAbierto, setAseAbierto] = useState<string | null>(null); // asesor expandido
  const [tecAbierto, setTecAbierto] = useState<string | null>(null); // técnico expandido

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchWithSupabaseSession(`/api/proyectos/panel`, { cache: "no-store" });
        const j = (await res.json()) as { success?: boolean; data?: Panel; error?: string };
        if (!res.ok || j.success !== true || !j.data) throw new Error(j.error ?? `Error ${res.status}`);
        if (!cancel) setData(j.data);
      } catch (e) {
        if (!cancel) setErr(e instanceof Error ? e.message : "Error al cargar");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (loading || !data) return;
    setBarrasMontadas(false);
    // Doble rAF: el primero deja que el navegador pinte la altura 0, el
    // segundo recién dispara el cambio a la altura real — con uno solo, a
    // veces el navegador agrupa los dos frames y la transición no se ve.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setBarrasMontadas(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [loading, data]);

  if (loading) return <div className="py-20 text-center text-sm text-slate-400">Cargando panel…</div>;
  if (err) return <div className="py-20 text-center text-sm text-rose-600">{err}</div>;
  if (!data) return null;

  const maxEstadoCant = Math.max(1, ...data.por_estado.map((e) => e.cantidad));
  const maxAsePres = Math.max(1, ...data.por_asesor.map((a) => a.presupuesto));
  const maxTecCant = Math.max(1, ...data.por_tecnico.map((t) => t.cantidad));
  const maxMesCant = Math.max(
    1,
    ...data.entregados_por_mes.flatMap((m) => [m.web.cantidad, m.saas.cantidad, m.mixto.cantidad])
  );
  const hayMixtos = data.entregados_por_mes.some((m) => m.mixto.cantidad > 0);
  const maxRubro = Math.max(1, ...data.por_rubro.map((r) => r.cantidad));

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        Vista completa — <span className="font-medium">todos los proyectos</span> activos (sin filtro por mes).
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Proyectos" value={String(data.kpis.total)} sub={`${data.kpis.en_curso} en curso`} />
        <Kpi label="Entregados (mes)" value={String(data.kpis.entregados_mes)} sub={fmtGs(data.kpis.entregados_mes_monto)} accent="ok" />
        <Kpi label="Presupuesto cerrado" value={fmtGs(data.kpis.presupuesto_total)} sub={`${data.kpis.con_presupuesto}/${data.kpis.total} con factura`} accent="money" />
        <Kpi label="Ticket promedio" value={fmtGs(data.kpis.ticket_promedio)} accent="money" />
        <Kpi label="SLA vencidos" value={String(data.kpis.sla_vencidos)} accent={data.kpis.sla_vencidos > 0 ? "danger" : undefined} />
        <Kpi label="En curso" value={String(data.kpis.en_curso)} sub="no entregados" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Por estado — cantidad y presupuesto</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70">
              <tr>
                {["Estado", "Proyectos", "", "Presupuesto", "SLA vencidos"].map((h, i) => (
                  <th key={i} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${i === 3 || i === 4 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.por_estado.map((e) => (
                <tr key={e.estado} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2.5 font-medium text-slate-800">
                    {e.estado}
                    {e.es_final ? <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">final</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{e.cantidad}</td>
                  <td className="px-3 py-2.5 w-[30%]"><Bar value={e.cantidad} max={maxEstadoCant} className={e.es_final ? "bg-emerald-400" : "bg-[#4FAEB2]"} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#3F8E91]">{fmtGs(e.presupuesto)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {e.sla_configurado ? (
                      <span className={e.sla_vencidos > 0 ? "font-semibold text-rose-600" : "text-slate-400"}>{e.sla_vencidos}</span>
                    ) : (
                      <span className="text-[11px] text-slate-300">sin SLA</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Por asesor comercial</h2>
        <p className="mb-3 text-[11px] text-slate-400">Carga vigente: activos + entregados este mes (no arrastra entregas de meses anteriores). Tocá para ver sus proyectos.</p>
        <div className="space-y-2">
          {data.por_asesor.map((a) => {
            const open = aseAbierto === a.asesor;
            return (
              <div key={a.asesor} className="min-w-0">
                <button type="button" onClick={() => setAseAbierto(open ? null : a.asesor)} className="w-full rounded-lg px-1 py-1 text-left transition-colors hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm font-medium ${open ? "text-[#3F8E91]" : "text-slate-800"}`}>{a.asesor}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {a.cantidad} proy · <span className="font-semibold text-[#3F8E91]">{fmtGs(a.presupuesto)}</span>
                    </span>
                  </div>
                  <div className="mt-1"><Bar value={a.presupuesto} max={maxAsePres} /></div>
                </button>
                {open ? (
                  <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/40">
                    <ProyectosDetalleTabla proyectos={a.proyectos} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Por técnico</h2>
        <p className="mb-3 text-[11px] text-slate-400">Carga vigente: activos + entregados este mes (no arrastra entregas de meses anteriores). Tocá para ver sus proyectos.</p>
        {data.por_tecnico.length === 0 ? (
          <p className="text-xs text-slate-400">Sin proyectos con técnico asignado.</p>
        ) : (
          <div className="space-y-2">
            {data.por_tecnico.map((t) => {
              const open = tecAbierto === t.tecnico;
              return (
                <div key={t.tecnico} className="min-w-0">
                  <button type="button" onClick={() => setTecAbierto(open ? null : t.tecnico)} className="w-full rounded-lg px-1 py-1 text-left transition-colors hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm font-medium ${open ? "text-[#3F8E91]" : "text-slate-800"}`}>{t.tecnico}</span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {t.cantidad} proy · <span className="font-semibold text-[#3F8E91]">{fmtGs(t.presupuesto)}</span>
                      </span>
                    </div>
                    <div className="mt-1"><Bar value={t.cantidad} max={maxTecCant} className="bg-[#4FAEB2]/80" /></div>
                  </button>
                  {open ? (
                    <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/40">
                      <ProyectosDetalleTabla proyectos={t.proyectos} mostrarVendedor />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Por tipo</h2>
          <div className="space-y-2">
            {data.por_tipo.map((t) => (
              <div key={t.tipo} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{t.tipo}</span>
                <span className="text-slate-500">
                  {t.cantidad} · <span className="font-semibold text-[#3F8E91]">{fmtGs(t.presupuesto)}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Por rubro (web)</h2>
          <div className="space-y-1.5">
            {data.por_rubro.slice(0, 10).map((r) => (
              <div key={r.rubro} className="min-w-0">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-700">{r.rubro}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">{r.cantidad}</span>
                </div>
                <div className="mt-0.5"><Bar value={r.cantidad} max={maxRubro} className="bg-[#4FAEB2]/70" /></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Entregados por mes</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Últimos 6 meses · tocá una barra para ver el detalle
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full bg-[#3F8E91]" aria-hidden="true" />
              Proyecto Web
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-full bg-[#8b5cf6]" aria-hidden="true" />
              SaaS / ERP
            </span>
            {hayMixtos ? (
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
                Mixto
              </span>
            ) : null}
          </div>
        </div>

        {/* Una sola línea de base corrida bajo los seis meses: el borde vive en
            el contenedor, no en cada barra, para que quede un único eje. */}
        <div className="flex items-end justify-between gap-1 border-b border-slate-200">
          {data.entregados_por_mes.map((m) => {
            const activo = mesSel === m.ym;
            const PLOT_H = 88;
            const alto = (cant: number) =>
              maxMesCant > 0 && cant > 0 ? Math.max(4, Math.round((cant / maxMesCant) * PLOT_H)) : 0;

            const barra = (cant: number, gradiente: string, gradienteActivo: string) => (
              <div className="flex flex-col items-center justify-end" style={{ height: PLOT_H + 22 }}>
                <span
                  className={`mb-1.5 text-[13px] font-bold tabular-nums transition-transform duration-300 ${
                    cant > 0 ? "text-slate-700" : "text-slate-300"
                  } ${activo ? "scale-110" : ""}`}
                >
                  {cant}
                </span>
                {/* origin-bottom: al agrandarse en el mes activo, crece hacia
                    arriba desde la base — nunca se despega de la línea de base. */}
                <div
                  className="w-3.5 origin-bottom rounded-t-[4px] shadow-sm transition-[height,transform] duration-500 ease-out sm:w-4"
                  style={{
                    height: barrasMontadas ? alto(cant) : 0,
                    backgroundImage: activo ? gradienteActivo : gradiente,
                    transform: activo ? "scale(1.08)" : "scale(1)",
                  }}
                />
              </div>
            );

            return (
              <button
                key={m.ym}
                type="button"
                onClick={() => setMesSel(activo ? null : m.ym)}
                className={`group flex flex-1 flex-col items-center gap-2 rounded-t-lg pb-2 pt-1.5 transition-colors ${
                  activo ? "bg-slate-50" : "hover:bg-slate-50/70"
                }`}
                title={`${mesLabel(m.ym)} · ${m.web.cantidad} Proyecto Web · ${m.saas.cantidad} SaaS/ERP${
                  hayMixtos ? ` · ${m.mixto.cantidad} mixto` : ""
                } · ${fmtGs(m.monto)}`}
              >
                <div className="flex items-end gap-1">
                  {barra(m.web.cantidad, GRADIENTE_WEB, GRADIENTE_WEB_ACTIVO)}
                  {barra(m.saas.cantidad, GRADIENTE_SAAS, GRADIENTE_SAAS_ACTIVO)}
                  {hayMixtos ? barra(m.mixto.cantidad, GRADIENTE_MIXTO, GRADIENTE_MIXTO_ACTIVO) : null}
                </div>
                <span
                  className={`text-[10px] font-medium transition-colors ${
                    activo ? "font-semibold text-[#2F6E71]" : "text-slate-500 group-hover:text-slate-700"
                  }`}
                >
                  {mesLabel(m.ym)}
                </span>
              </button>
            );
          })}
        </div>

        {mesSel ? (
          (() => {
            const mes = data.entregados_por_mes.find((m) => m.ym === mesSel);
            if (!mes) return null;
            return (
              <div className="mt-4 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Entregados en {mesLabel(mesSel)} · {mes.cantidad} · <span className="text-[#3F8E91]">{fmtGs(mes.monto)}</span>
                  </span>
                  <button type="button" onClick={() => setMesSel(null)} className="text-[11px] text-slate-400 hover:text-slate-600">
                    Cerrar
                  </button>
                </div>
                {mes.proyectos.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-slate-400">Sin entregas este mes.</p>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-100">
                        {mes.proyectos.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50/60">
                            <td className="px-3 py-2">
                              <span className="block font-medium text-slate-800">{p.cliente}</span>
                              {p.titulo && p.titulo !== p.cliente ? <span className="block text-[11px] text-slate-400">{p.titulo}</span> : null}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  p.tipo === "SaaS / ERP"
                                    ? "bg-violet-50 text-violet-700"
                                    : p.tipo === "Página Web + SaaS/ERP"
                                      ? "bg-slate-100 text-slate-600"
                                      : "bg-[#4FAEB2]/10 text-[#3F8E91]"
                                }`}
                              >
                                {p.tipo}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtFecha(p.fecha)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-[#3F8E91]">{fmtGs(p.monto)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()
        ) : null}
      </section>

      <p className="text-[11px] text-slate-400">
        Presupuesto = monto de la primera factura de venta (no suscripción) de cada cliente, leído en vivo. Los
        proyectos sin factura aún ({data.kpis.total - data.kpis.con_presupuesto}) no suman plata.
      </p>
    </div>
  );
}
