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
  AlertCircle,
  CheckCircle2,
  Clock,
  Quote,
  Hourglass,
  Layers,
  PauseCircle,
  Timer,
  UsersRound,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { KpiBucket } from "@/lib/proyectos/dashboard/shared";
import { nombreCapitular, nombreCorto } from "@/lib/format/nombres";
import {
  AMBAR,
  Card,
  CardTitle,
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
  proyectos_activos: (Data["criticos"][number] & {
    estado_id: string | null;
    demorado: boolean;
    buckets: KpiBucket[];
  })[];
  estados_activos: {
    estado_id: string;
    nombre: string;
    color: string;
    cantidad: number;
    demorados: number;
    umbral_horas: number | null;
  }[];
  total_activos: number;
  demorados_total: number;
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

/** Nombre de cada tarjeta KPI, para el título de la lista al filtrar por click. */
const KPI_LABEL: Record<KpiBucket, string> = {
  vencen_pronto: "Vencen pronto",
  vencidos: "Vencidos",
  bloqueados: "Detenidos",
  en_desarrollo: "En desarrollo",
  esperando_cliente: "Esperando cliente",
  esperando_qa: "Esperando QA",
  listos_entregar: "Listos para entregar",
};

/**
 * Las tres formas de desmenuzar la cartera, unificadas: una tarjeta de riesgo,
 * un estado, o los demorados (todos o de un estado puntual).
 */
type Sel =
  | { kind: "kpi"; bucket: KpiBucket }
  | { kind: "estado"; id: string }
  | { kind: "demorado"; estadoId?: string }
  | null;

/** ¿Dos selecciones son la misma? Para que apretar lo ya activo lo apague. */
function mismaSel(a: Sel, b: Sel): boolean {
  if (a == null || b == null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "kpi" && b.kind === "kpi") return a.bucket === b.bucket;
  if (a.kind === "estado" && b.kind === "estado") return a.id === b.id;
  if (a.kind === "demorado" && b.kind === "demorado") return a.estadoId === b.estadoId;
  return false;
}

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
  /**
   * Qué recorte se muestra en la lista de abajo. Un solo lugar para las tres
   * formas de desmenuzar: una tarjeta de riesgo (bucket), un estado, o los
   * demorados (todos o de un estado). `null` = la lista de críticos por defecto.
   */
  const [sel, setSel] = useState<Sel>(null);
  /** Apretar de nuevo lo mismo lo apaga (vuelve a críticos). */
  const toggleSel = useCallback(
    (s: Sel) => setSel((prev) => (mismaSel(prev, s) ? null : s)),
    []
  );

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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, fTipo, fEstado, fTecnico]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Los nombres del catálogo vienen en MAYÚSCULAS; en una lista gritan. */
  const tecnicos = useMemo(
    () => (data?.opciones.tecnicos ?? []).map((t) => ({ ...t, nombre: nombreCapitular(t.nombre) })),
    [data?.opciones.tecnicos]
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
   * La lista de abajo: por defecto los proyectos críticos; con una tarjeta KPI
   * seleccionada, TODOS los proyectos de ese bucket (aunque estén sanos y no
   * sean críticos). El número de la tarjeta y esta lista salen del mismo
   * criterio, así que coinciden.
   */
  const filasLista = useMemo(() => {
    if (!data) return [];
    if (!sel) return data.criticos;
    const act = data.proyectos_activos;
    if (sel.kind === "kpi") return act.filter((p) => p.buckets.includes(sel.bucket));
    if (sel.kind === "estado") return act.filter((p) => p.estado_id === sel.id);
    // demorado
    return act.filter((p) => p.demorado && (sel.estadoId ? p.estado_id === sel.estadoId : true));
  }, [data, sel]);

  /** Título de la lista según qué se está mirando. */
  const tituloLista = useMemo(() => {
    if (!sel) return "Proyectos críticos";
    if (sel.kind === "kpi") return KPI_LABEL[sel.bucket];
    if (sel.kind === "estado") {
      return data?.estados_activos.find((e) => e.estado_id === sel.id)?.nombre ?? "Estado";
    }
    if (sel.estadoId) {
      const n = data?.estados_activos.find((e) => e.estado_id === sel.estadoId)?.nombre;
      return `Demorados · ${n ?? "estado"}`;
    }
    return "Demorados";
  }, [sel, data]);

  return (
    <div className="space-y-3">
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
            {/* Contexto: qué población suman estos números. */}
            <p className="text-[11px] text-slate-400">{alcance}</p>

            {/* Panorama — el total y las señales que cruzan todos los estados.
                "¿Cómo estoy hoy?" de un vistazo. Cada señal se puede apretar
                para ver sus proyectos abajo. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi
                icon={Layers}
                tono={TONO.teal}
                label="Proyectos activos"
                numero={data.total_activos}
                pie={`${data.total_proyectos} en total`}
              />
              <Kpi
                icon={AlertCircle}
                tono={TONO.rojo}
                label="Vencidos"
                numero={data.kpis.vencidos}
                onClick={() => toggleSel({ kind: "kpi", bucket: "vencidos" })}
                seleccionado={sel?.kind === "kpi" && sel.bucket === "vencidos"}
              />
              <Kpi
                icon={Timer}
                tono={TONO.ambar}
                label="Vencen pronto"
                sublabel="≤ 3 días"
                numero={data.kpis.vencen_pronto}
                onClick={() => toggleSel({ kind: "kpi", bucket: "vencen_pronto" })}
                seleccionado={sel?.kind === "kpi" && sel.bucket === "vencen_pronto"}
              />
              <Kpi
                icon={Hourglass}
                tono={TONO.violeta}
                label="Demorados"
                sublabel="pasaron su tiempo objetivo"
                numero={data.demorados_total}
                onClick={() => toggleSel({ kind: "demorado" })}
                seleccionado={sel?.kind === "demorado" && !sel.estadoId}
              />
              <Kpi
                icon={PauseCircle}
                tono={TONO.gris}
                label="Detenidos"
                sublabel="pausados o bloqueados"
                numero={data.kpis.bloqueados}
                onClick={() => toggleSel({ kind: "kpi", bucket: "bloqueados" })}
                seleccionado={sel?.kind === "kpi" && sel.bucket === "bloqueados"}
              />
              <Kpi
                icon={UsersRound}
                tono={TONO.naranja}
                label="Técnicos con WIP alto"
                numero={data.kpis.tecnicos_wip_alto}
                pie={`de ${data.total_tecnicos} técnicos`}
              />
            </div>

            {/* Proyectos por estado — el centro del tablero: cuántos hay en cada
                estado y cuántos ya llevan demasiado tiempo. Apretá un estado
                para ver esos proyectos abajo; apretá "N demorados" para ver sólo
                los pasados de tiempo. El tiempo objetivo de cada estado se
                define en Configuración → Proyectos ("Definir tiempos"). */}
            <Card>
              <CardTitle
                right={
                  <Link
                    href="/configuracion/proyectos"
                    className="whitespace-nowrap text-[11px] font-medium text-[#4FAEB2] hover:underline"
                  >
                    Definir tiempos →
                  </Link>
                }
              >
                Proyectos por estado
              </CardTitle>
              {data.estados_activos.length === 0 ? (
                <p className="text-sm text-slate-400">Sin proyectos activos</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {data.estados_activos.map((e) => {
                    const activo = sel?.kind === "estado" && sel.id === e.estado_id;
                    const demActivo = sel?.kind === "demorado" && sel.estadoId === e.estado_id;
                    const irAlEstado = () => toggleSel({ kind: "estado", id: e.estado_id });
                    return (
                      <div
                        key={e.estado_id}
                        role="button"
                        tabIndex={0}
                        onClick={irAlEstado}
                        onKeyDown={(ev) => ev.key === "Enter" && irAlEstado()}
                        className={`cursor-pointer rounded-xl border bg-white p-3 transition-shadow hover:shadow-md ${
                          activo ? "border-transparent ring-2 ring-[#4FAEB2] ring-offset-1" : "border-slate-200"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
                          <span
                            className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-600"
                            title={e.nombre}
                          >
                            {e.nombre}
                          </span>
                        </div>
                        <div className="mt-1 text-[24px] font-bold leading-none text-slate-800">{e.cantidad}</div>
                        {e.demorados > 0 ? (
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              toggleSel({ kind: "demorado", estadoId: e.estado_id });
                            }}
                            title={
                              e.umbral_horas != null
                                ? `Más de ${e.umbral_horas} h en este estado`
                                : "Sin tiempo objetivo definido para este estado"
                            }
                            className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                              demActivo ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                            }`}
                          >
                            <Hourglass className="h-2.5 w-2.5" />
                            {e.demorados} demorado{e.demorados === 1 ? "" : "s"}
                          </button>
                        ) : e.umbral_horas == null ? (
                          <span className="mt-1.5 inline-block text-[9px] text-slate-300">sin tiempo objetivo</span>
                        ) : (
                          <span className="mt-1.5 inline-block text-[9px] text-emerald-500">al día</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Cumplimiento + Lead time */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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

            {/* G · H */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardTitle
                  right={
                    sel ? (
                      <button
                        type="button"
                        onClick={() => setSel(null)}
                        className="whitespace-nowrap text-[11px] font-medium text-[#4FAEB2] hover:underline"
                      >
                        ← Ver críticos
                      </button>
                    ) : (
                      <Link
                        href="/dashboard/proyectos"
                        className="whitespace-nowrap text-[11px] font-medium text-[#4FAEB2] hover:underline"
                      >
                        Ver todos →
                      </Link>
                    )
                  }
                >
                  {sel ? (
                    <span className="flex items-center gap-1.5">
                      {tituloLista}
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {filasLista.length}
                      </span>
                    </span>
                  ) : (
                    "Proyectos críticos"
                  )}
                </CardTitle>
                {filasLista.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {sel ? "Sin proyectos en esta selección." : "Nada crítico. Buen día."}
                  </p>
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
                        {filasLista.map((c) => (
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
                              {c.motivo && c.motivo !== "—" ? (
                                <Pill className={SEMAFORO_PILL[c.semaforo]}>{c.motivo}</Pill>
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
