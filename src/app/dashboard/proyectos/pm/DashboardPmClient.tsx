"use client";

/**
 * Dashboard PM — la pantalla de acción del Project Manager.
 *
 * A diferencia del Ejecutivo, acá sí hay listas: el PM abre el sistema y tiene
 * que saber en diez segundos dónde meterse hoy. Por eso "Atención PM de hoy" es
 * el bloque principal y todo lo demás son cortes de lo mismo.
 *
 * El orden de esa tabla lo decide el servidor (`priority-score.ts`), no el
 * frontend: si cada tabla ordenara a su gusto, dos pantallas mostrarían el
 * mismo día en dos órdenes distintos.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  CheckCircle2,
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
import { SLV_META, type NivelSlv } from "@/lib/proyectos/dashboard/semaforo";
import {
  AMBAR,
  Card,
  CardTitle,
  Estado,
  EstadoPill,
  FiltroPill,
  Kpi,
  Pill,
  PillSelect,
  ROJO,
  TONO,
  TablaWrap,
  VERDE,
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
    estancados: number;
    esperando_cliente: number;
    esperando_qa: number;
    listos_entregar: number;
    tecnicos_wip_alto: number;
  };
  wip_limite: number;
  puede_ver_todo: boolean;
  atencion: {
    id: string;
    titulo: string;
    cliente: string;
    estado_nombre: string;
    estado_color: string;
    motivo: string;
    motivo_codigo: string | null;
    tiempo_en_estado_ms: number | null;
    fecha_prometida: string | null;
    proxima_accion: string;
    dueno: string;
  }[];
  slv_por_desarrollador: {
    usuario_id: string;
    nombre: string;
    wip: number;
    dentro: number;
    en_riesgo: number;
    vencidos: number;
    cerrados: number;
    cumplimiento_pct: number | null;
  }[];
  riesgo_slv: {
    id: string;
    titulo: string;
    tecnico: string;
    estado_nombre: string;
    estado_color: string;
    consumido_ms: number;
    objetivo_horas: number | null;
    consumo_pct: number | null;
    nivel: NivelSlv | null;
    sin_movimiento_ms: number | null;
    sin_movimiento: boolean;
    atribucion_confiable: boolean;
  }[];
  wip: Wip[];
  qa_retrabajos: {
    id: string;
    titulo: string;
    tecnico: string;
    rondas: number;
    ultima_entrada_at: string | null;
    estado_nombre: string;
    destacado: boolean;
  }[];
  esperando_cliente: {
    id: string;
    titulo: string;
    cliente: string;
    falta: string;
    desde: string | null;
    tiempo_ms: number | null;
    ultimo_contacto: string | null;
  }[];
  bloqueos: {
    id: string;
    titulo: string;
    tipo: string;
    tipo_label: string;
    motivo: string;
    desde: string | null;
    tiempo_ms: number | null;
    proxima_accion: string;
    responsable: string;
  }[];
  opciones: { tipos: Opcion[]; estados: Opcion[]; tecnicos: Opcion[] };
  atribucion_parcial: boolean;
};

const COLOR_WIP: Record<Wip["nivel"], string> = {
  sobre_limite: ROJO,
  al_limite: AMBAR,
  en_rango: VERDE,
};

/** Color de la píldora del motivo, por familia. Rojo lo urgente, ámbar lo que espera. */
const MOTIVO_PILL: Record<string, string> = {
  vencido: "bg-rose-50 text-rose-700",
  slv_vencido: "bg-rose-50 text-rose-700",
  bloqueado: "bg-slate-100 text-slate-700",
  vence_pronto: "bg-amber-50 text-amber-700",
  sin_movimiento: "bg-orange-50 text-orange-700",
  slv_critico: "bg-orange-50 text-orange-700",
  estancado: "bg-orange-50 text-orange-700",
  reingreso_qa: "bg-violet-50 text-violet-700",
  espera_cliente: "bg-amber-50 text-amber-700",
  listo_entregar: "bg-emerald-50 text-emerald-700",
  slv_riesgo: "bg-amber-50 text-amber-700",
};

const COLOR_TIPO_BLOQUEO: Record<string, string> = {
  cliente: "bg-amber-50 text-amber-700",
  tercero: "bg-violet-50 text-violet-700",
  interno: "bg-rose-50 text-rose-700",
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

export default function DashboardPmClient() {
  const [hasta, setHasta] = useState(hoyIso);
  const [mios, setMios] = useState(true);
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
      if (hasta) qs.set("hasta", hasta);
      if (mios) qs.set("mios", "1");
      if (fTipo) qs.set("tipo_id", fTipo);
      if (fEstado) qs.set("estado_id", fEstado);
      if (fTecnico) qs.set("responsable_tecnico_id", fTecnico);
      const r = await fetchWithSupabaseSession(`/api/proyectos/dashboard-pm?${qs}`, { cache: "no-store" });
      setData(await leerRespuesta<Data>(r));
      setActualizado(new Date().toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, [hasta, mios, fTipo, fEstado, fTecnico]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const wipChart = useMemo(
    () => (data?.wip ?? []).slice(0, 8).map((w) => ({ ...w, corto: nombreCorto(w.nombre) })),
    [data?.wip]
  );

  const vacio = !!data && data.atencion.length === 0 && data.wip.length === 0;

  return (
    <div className="space-y-3">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-slate-800">Dashboard PM</h1>
          <p className="text-[13px] text-slate-500">Tu día, tus proyectos, tus acciones</p>
          <p className="text-[12px] text-slate-400">Todo lo que necesitás para gestionar tu cartera</p>
        </div>
        <button
          type="button"
          onClick={() => void cargar()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <FiltroPill label="Fecha">
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="w-full cursor-pointer bg-transparent text-right text-[13px] text-slate-500 focus:outline-none"
          />
        </FiltroPill>
        {/*
          "Mis proyectos" sale de la cartera real del PM (clientes.project_manager_id).
          Un PM que no es admin ve su cartera igual, elija lo que elija: el
          servidor no le devuelve otra cosa.
        */}
        <FiltroPill label="Cartera">
          <button
            type="button"
            onClick={() => setMios((v) => !v)}
            disabled={!data?.puede_ver_todo}
            className="w-full text-right text-[13px] text-slate-700 focus:outline-none disabled:text-slate-400"
          >
            {mios ? "Mis proyectos" : "Todos"}
          </button>
        </FiltroPill>
        <PillSelect label="Tipo" value={fTipo} onChange={setFTipo} options={data?.opciones.tipos ?? []} />
        <PillSelect label="Estado" value={fEstado} onChange={setFEstado} options={data?.opciones.estados ?? []} />
        <PillSelect
          label="Técnico"
          value={fTecnico}
          onChange={setFTecnico}
          options={data?.opciones.tecnicos ?? []}
          placeholder="Todos los técnicos"
        />
      </div>

      <Estado loading={loading && !data} error={err} vacio={vacio}>
        {data ? (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Kpi icon={Timer} tono={TONO.ambar} label="Vencen pronto" sublabel="≤ 3 días" numero={data.kpis.vencen_pronto} />
              <Kpi icon={AlertCircle} tono={TONO.rojo} label="Vencidos" numero={data.kpis.vencidos} />
              <Kpi icon={Lock} tono={TONO.gris} label="Bloqueados" numero={data.kpis.bloqueados} />
              <Kpi icon={Hourglass} tono={TONO.naranja} label="Estancados" numero={data.kpis.estancados} />
              <Kpi icon={Users} tono={TONO.violeta} label="Esperando cliente" numero={data.kpis.esperando_cliente} />
              <Kpi icon={CheckCircle2} tono={TONO.azul} label="Esperando QA" numero={data.kpis.esperando_qa} />
              <Kpi icon={Flag} tono={TONO.verde} label="Listos para entregar" numero={data.kpis.listos_entregar} />
              <Kpi icon={UsersRound} tono={TONO.rojo} label="WIP técnico alto" numero={data.kpis.tecnicos_wip_alto} />
            </div>

            {/* Atención PM de hoy — el bloque principal */}
            <Card>
              <CardTitle
                right={
                  <Link href="/dashboard/proyectos" className="whitespace-nowrap text-[11px] font-medium text-[#4FAEB2] hover:underline">
                    Ver todos →
                  </Link>
                }
              >
                Atención PM de hoy
              </CardTitle>
              {data.atencion.length === 0 ? (
                <p className="text-sm text-slate-400">Nada pendiente hoy. Disfrutalo.</p>
              ) : (
                <TablaWrap>
                  <table className="w-full min-w-[860px] text-left">
                    <thead>
                      <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="pb-1.5 pr-2 font-medium">Proyecto</th>
                        <th className="pb-1.5 pr-2 font-medium">Cliente</th>
                        <th className="pb-1.5 pr-2 font-medium">Estado</th>
                        <th className="pb-1.5 pr-2 font-medium">Motivo</th>
                        <th className="pb-1.5 pr-2 font-medium">En estado</th>
                        <th className="pb-1.5 pr-2 font-medium">Prometida</th>
                        <th className="pb-1.5 pr-2 font-medium">Próxima acción</th>
                        <th className="pb-1.5 font-medium">Dueño</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.atencion.map((p) => (
                        <tr key={p.id} className="border-b border-slate-50 text-[11px] last:border-0">
                          <td className="max-w-[150px] truncate py-1.5 pr-2 font-medium text-slate-700">
                            <Link href={`/dashboard/proyectos?proyecto=${p.id}`} className="hover:underline" title={p.titulo}>
                              {p.titulo}
                            </Link>
                          </td>
                          <td className="max-w-[130px] truncate py-1.5 pr-2 text-slate-500" title={p.cliente}>
                            {p.cliente}
                          </td>
                          <td className="py-1.5 pr-2">
                            <EstadoPill nombre={p.estado_nombre} color={p.estado_color} />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Pill className={MOTIVO_PILL[p.motivo_codigo ?? ""] ?? "bg-slate-100 text-slate-600"}>
                              {p.motivo}
                            </Pill>
                          </td>
                          <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-slate-500">
                            {fmtDur(p.tiempo_en_estado_ms)}
                          </td>
                          <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-slate-500">
                            {fmtFecha(p.fecha_prometida)}
                          </td>
                          <td className="max-w-[140px] truncate py-1.5 pr-2 text-slate-600">{p.proxima_accion}</td>
                          <td className="max-w-[110px] truncate py-1.5 text-slate-500">{nombreCorto(p.dueno)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TablaWrap>
              )}
            </Card>

            {/* SLV por desarrollador · WIP del equipo */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card>
                <CardTitle>SLV por desarrollador</CardTitle>
                {data.slv_por_desarrollador.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin datos</p>
                ) : (
                  <TablaWrap>
                    <table className="w-full min-w-[440px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="pb-1.5 pr-2 font-medium">Técnico</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">WIP</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">Dentro</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">En riesgo</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">Vencidos</th>
                          <th className="pb-1.5 text-right font-medium">Cumplimiento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.slv_por_desarrollador.map((t) => (
                          <tr key={t.usuario_id} className="border-b border-slate-50 text-[11px] last:border-0">
                            <td className="max-w-[130px] truncate py-1.5 pr-2 font-medium text-slate-700" title={t.nombre}>
                              {nombreCorto(t.nombre)}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{t.wip}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{t.dentro}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums font-semibold text-amber-600">
                              {t.en_riesgo}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums font-semibold text-rose-600">
                              {t.vencidos}
                            </td>
                            <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                              {t.cumplimiento_pct != null ? (
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{
                                      background:
                                        t.cumplimiento_pct >= 90 ? VERDE : t.cumplimiento_pct >= 70 ? AMBAR : ROJO,
                                    }}
                                  />
                                  <span className="font-semibold text-slate-700">{t.cumplimiento_pct}%</span>
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TablaWrap>
                )}
                <p className="mt-2 text-[10px] leading-tight text-slate-400">
                  &quot;En riesgo&quot; y &quot;Vencidos&quot; miran el trabajo en curso. El cumplimiento se calcula sobre
                  lo ya terminado con objetivo: son dos poblaciones distintas.
                </p>
              </Card>

              <Card>
                <CardTitle>WIP del equipo</CardTitle>
                {wipChart.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin datos</p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={Math.max(150, wipChart.length * 26)}>
                      <BarChart layout="vertical" data={wipChart} margin={{ top: 4, right: 30, left: 4, bottom: 0 }}>
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="corto"
                          width={92}
                          tick={{ fontSize: 10, fill: "#64748b" }}
                          axisLine={false}
                          tickLine={false}
                          interval={0}
                        />
                        <Tooltip formatter={(v: number) => [`${v}`, "Proyectos"]} />
                        <ReferenceLine x={data.wip_limite} stroke="#22c55e" strokeDasharray="3 3" />
                        <Bar dataKey="wip" radius={[0, 3, 3, 0]} barSize={12}>
                          <LabelList
                            dataKey="wip"
                            position="right"
                            style={{ fontSize: 10, fill: "#475569", fontWeight: 600 }}
                          />
                          {wipChart.map((w) => (
                            <Cell key={w.usuario_id} fill={COLOR_WIP[w.nivel]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
                      <span className="inline-block h-px w-5 border-t border-dashed border-emerald-500" />
                      Límite recomendado: {data.wip_limite}
                    </div>
                  </>
                )}
              </Card>
            </div>

            {/* Riesgo SLV · QA y retrabajos */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card>
                <CardTitle>Proyectos en riesgo SLV (técnicos)</CardTitle>
                {data.riesgo_slv.length === 0 ? (
                  <p className="text-sm text-slate-400">Nada en riesgo</p>
                ) : (
                  <TablaWrap>
                    <table className="w-full min-w-[520px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="pb-1.5 pr-2 font-medium">Proyecto</th>
                          <th className="pb-1.5 pr-2 font-medium">Técnico</th>
                          <th className="pb-1.5 pr-2 font-medium">Estado</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">Tiempo</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">Objetivo</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">Consumo</th>
                          <th className="pb-1.5 text-right font-medium">Sin mov.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.riesgo_slv.map((p) => (
                          <tr key={p.id} className="border-b border-slate-50 text-[11px] last:border-0">
                            <td className="max-w-[130px] truncate py-1.5 pr-2 font-medium text-slate-700">
                              <Link href={`/dashboard/proyectos?proyecto=${p.id}`} className="hover:underline" title={p.titulo}>
                                {p.titulo}
                              </Link>
                              {!p.atribucion_confiable ? (
                                <span
                                  className="ml-1 text-slate-300"
                                  title="Parte del tiempo viene de historial anterior al snapshot de técnico"
                                >
                                  *
                                </span>
                              ) : null}
                            </td>
                            <td className="max-w-[100px] truncate py-1.5 pr-2 text-slate-500">
                              {nombreCorto(p.tecnico)}
                            </td>
                            <td className="py-1.5 pr-2">
                              <EstadoPill nombre={p.estado_nombre} color={p.estado_color} />
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-slate-600">
                              {fmtDur(p.consumido_ms)}
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-slate-500">
                              {p.objetivo_horas != null ? `${p.objetivo_horas} h` : "—"}
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-2 text-right">
                              {p.nivel ? (
                                <Pill className={SLV_META[p.nivel].pill}>{p.consumo_pct}%</Pill>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                              <span className={p.sin_movimiento ? "font-semibold text-rose-600" : "text-slate-400"}>
                                {fmtDur(p.sin_movimiento_ms)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TablaWrap>
                )}
              </Card>

              <Card>
                <CardTitle>QA y retrabajos</CardTitle>
                {data.qa_retrabajos.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin retrabajos</p>
                ) : (
                  <TablaWrap>
                    <table className="w-full min-w-[420px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="pb-1.5 pr-2 font-medium">Proyecto</th>
                          <th className="pb-1.5 pr-2 font-medium">Técnico</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">Rondas</th>
                          <th className="pb-1.5 font-medium">Última entrada a QA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.qa_retrabajos.map((p) => (
                          <tr key={p.id} className="border-b border-slate-50 text-[11px] last:border-0">
                            <td className="max-w-[150px] truncate py-1.5 pr-2 font-medium text-slate-700">
                              <Link href={`/dashboard/proyectos?proyecto=${p.id}`} className="hover:underline" title={p.titulo}>
                                {p.titulo}
                              </Link>
                            </td>
                            <td className="max-w-[110px] truncate py-1.5 pr-2 text-slate-500">
                              {nombreCorto(p.tecnico)}
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              <Pill className={p.destacado ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}>
                                {p.rondas}
                              </Pill>
                            </td>
                            <td className="whitespace-nowrap py-1.5 tabular-nums text-slate-500">
                              {fmtFecha(p.ultima_entrada_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TablaWrap>
                )}
              </Card>
            </div>

            {/* Esperando cliente · Bloqueos activos */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card>
                <CardTitle>Esperando cliente</CardTitle>
                {data.esperando_cliente.length === 0 ? (
                  <p className="text-sm text-slate-400">Nada esperando al cliente</p>
                ) : (
                  <TablaWrap>
                    <table className="w-full min-w-[460px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="pb-1.5 pr-2 font-medium">Proyecto</th>
                          <th className="pb-1.5 pr-2 font-medium">Cliente</th>
                          <th className="pb-1.5 pr-2 font-medium">Qué falta</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">Esperando</th>
                          <th className="pb-1.5 font-medium">Último contacto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.esperando_cliente.map((p) => (
                          <tr key={p.id} className="border-b border-slate-50 text-[11px] last:border-0">
                            <td className="max-w-[130px] truncate py-1.5 pr-2 font-medium text-slate-700">
                              <Link href={`/dashboard/proyectos?proyecto=${p.id}`} className="hover:underline" title={p.titulo}>
                                {p.titulo}
                              </Link>
                            </td>
                            <td className="max-w-[120px] truncate py-1.5 pr-2 text-slate-500" title={p.cliente}>
                              {p.cliente}
                            </td>
                            <td className="max-w-[130px] truncate py-1.5 pr-2 text-slate-500">{p.falta}</td>
                            <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums font-semibold text-amber-600">
                              {fmtDur(p.tiempo_ms)}
                            </td>
                            <td className="whitespace-nowrap py-1.5 tabular-nums text-slate-500">
                              {fmtFecha(p.ultimo_contacto)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TablaWrap>
                )}
                <p className="mt-2 text-[10px] leading-tight text-slate-400">
                  Este tiempo se muestra pero no consume SLV técnico: el reloj del desarrollador está detenido.
                </p>
              </Card>

              <Card>
                <CardTitle>Bloqueos activos</CardTitle>
                {data.bloqueos.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin bloqueos</p>
                ) : (
                  <TablaWrap>
                    <table className="w-full min-w-[500px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="pb-1.5 pr-2 font-medium">Proyecto</th>
                          <th className="pb-1.5 pr-2 font-medium">Tipo</th>
                          <th className="pb-1.5 pr-2 font-medium">Motivo</th>
                          <th className="pb-1.5 pr-2 text-right font-medium">Desde</th>
                          <th className="pb-1.5 pr-2 font-medium">Próxima acción</th>
                          <th className="pb-1.5 font-medium">Responsable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.bloqueos.map((p) => (
                          <tr key={p.id} className="border-b border-slate-50 text-[11px] last:border-0">
                            <td className="max-w-[120px] truncate py-1.5 pr-2 font-medium text-slate-700">
                              <Link href={`/dashboard/proyectos?proyecto=${p.id}`} className="hover:underline" title={p.titulo}>
                                {p.titulo}
                              </Link>
                            </td>
                            <td className="py-1.5 pr-2">
                              <Pill className={COLOR_TIPO_BLOQUEO[p.tipo] ?? "bg-slate-100 text-slate-600"}>
                                {p.tipo_label}
                              </Pill>
                            </td>
                            <td className="max-w-[130px] truncate py-1.5 pr-2 text-slate-500" title={p.motivo}>
                              {p.motivo}
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-slate-500">
                              {fmtDur(p.tiempo_ms)}
                            </td>
                            <td className="max-w-[120px] truncate py-1.5 pr-2 text-slate-600">{p.proxima_accion}</td>
                            <td className="max-w-[100px] truncate py-1.5 text-slate-500">{nombreCorto(p.responsable)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TablaWrap>
                )}
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
              <span>
                {data.atribucion_parcial
                  ? "* Tiempo con atribución aproximada: viene de historial anterior al snapshot de técnico."
                  : "Convirtiendo proyectos en resultados"}
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
