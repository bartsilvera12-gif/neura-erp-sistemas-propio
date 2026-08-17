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
  entregados_por_mes: {
    ym: string;
    cantidad: number;
    monto: number;
    proyectos: { id: string; titulo: string; cliente: string; monto: number; fecha: string | null }[];
  }[];
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
  es_final: boolean;
  presupuesto: number;
  dias_en_estado: number | null;
  sla_vencido: boolean;
  sla_texto: string;
};

function fmtGs(n: number): string {
  return `₲ ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(n || 0)}`;
}

/** Tabla de proyectos de un responsable (etapa, presupuesto, SLA). */
function ProyectosDetalleTabla({ proyectos }: { proyectos: DetalleProy[] }) {
  if (!proyectos.length) return <p className="px-3 py-3 text-xs text-slate-400">Sin proyectos.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-slate-100 bg-slate-50/60">
          <tr>
            {["Cliente / Proyecto", "Etapa", "Presupuesto", "SLA"].map((h, i) => (
              <th key={i} className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 ${i >= 2 ? "text-right" : "text-left"}`}>
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
              <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-[#3F8E91]">{fmtGs(p.presupuesto)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-[11px]">
                <span className={p.sla_vencido ? "font-semibold text-rose-600" : "text-slate-400"}>{p.sla_texto}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
 * Si se pasan `desde`/`hasta` (YYYY-MM-DD), el panel se acota al período POR FECHA DE INGRESO.
 */
export default function PanelProyectosPanel({
  desde,
  hasta,
  periodoLabel,
}: {
  desde?: string;
  hasta?: string;
  periodoLabel?: string;
}) {
  const [data, setData] = useState<Panel | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mesSel, setMesSel] = useState<string | null>(null); // ym del histórico abierto
  const [aseAbierto, setAseAbierto] = useState<string | null>(null); // asesor expandido
  const [tecAbierto, setTecAbierto] = useState<string | null>(null); // técnico expandido

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const qs = desde && hasta ? `?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}` : "";
        const res = await fetchWithSupabaseSession(`/api/proyectos/panel${qs}`, { cache: "no-store" });
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
  }, [desde, hasta]);

  if (loading) return <div className="py-20 text-center text-sm text-slate-400">Cargando panel…</div>;
  if (err) return <div className="py-20 text-center text-sm text-rose-600">{err}</div>;
  if (!data) return null;

  const maxEstadoCant = Math.max(1, ...data.por_estado.map((e) => e.cantidad));
  const maxAsePres = Math.max(1, ...data.por_asesor.map((a) => a.presupuesto));
  const maxTecCant = Math.max(1, ...data.por_tecnico.map((t) => t.cantidad));
  const maxMesCant = Math.max(1, ...data.entregados_por_mes.map((m) => m.cantidad));
  const maxRubro = Math.max(1, ...data.por_rubro.map((r) => r.cantidad));

  return (
    <div className="space-y-5">
      {data.periodo_filtrado ? (
        <p className="text-xs text-slate-500">
          Mostrando <span className="font-semibold text-slate-700">{periodoLabel ?? "el período"}</span> — proyectos
          por <span className="font-medium">fecha de ingreso</span>. Cambiá el período con el selector de arriba.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={data.periodo_filtrado ? "Proyectos (ingresados)" : "Proyectos"} value={String(data.kpis.total)} sub={`${data.kpis.en_curso} en curso`} />
        <Kpi label="Entregados del período" value={String(data.kpis.entregados_mes)} sub={fmtGs(data.kpis.entregados_mes_monto)} accent="ok" />
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
        <p className="mb-3 text-[11px] text-slate-400">Tocá un asesor para ver sus proyectos (etapa, presupuesto y SLA).</p>
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
        <p className="mb-3 text-[11px] text-slate-400">Tocá un técnico para ver sus proyectos (etapa, presupuesto y SLA).</p>
        {data.por_tecnico.length === 0 ? (
          <p className="text-xs text-slate-400">Sin proyectos con técnico en este período.</p>
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
                      <ProyectosDetalleTabla proyectos={t.proyectos} />
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
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Entregados por mes (últimos 6)</h2>
        <p className="mb-3 text-[11px] text-slate-400">Tocá una barra para ver los proyectos entregados de ese mes.</p>
        <div className="flex items-end justify-between gap-2">
          {data.entregados_por_mes.map((m) => {
            const h = maxMesCant > 0 ? Math.max(6, Math.round((m.cantidad / maxMesCant) * 90)) : 6;
            const activo = mesSel === m.ym;
            return (
              <button
                key={m.ym}
                type="button"
                onClick={() => setMesSel(activo ? null : m.ym)}
                className="flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1 transition-colors hover:bg-slate-50"
                title={`${m.cantidad} entregados · ${fmtGs(m.monto)}`}
              >
                <span className="text-[11px] font-semibold tabular-nums text-slate-700">{m.cantidad}</span>
                <div className="flex h-[90px] w-full items-end">
                  <div
                    className={`mx-auto w-8 rounded-t-md transition-colors ${activo ? "bg-[#3F8E91]" : "bg-[#4FAEB2] hover:bg-[#3F8E91]"}`}
                    style={{ height: `${h}px` }}
                  />
                </div>
                <span className={`text-[10px] ${activo ? "font-semibold text-[#3F8E91]" : "text-slate-500"}`}>{mesLabel(m.ym)}</span>
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
