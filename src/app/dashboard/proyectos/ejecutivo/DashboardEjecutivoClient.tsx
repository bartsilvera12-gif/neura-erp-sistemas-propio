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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
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
  Card,
  CardTitle,
  Estado,
  EstadoPill,
  FiltroFecha,
  Kpi,
  PillSelect,
  TONO,
  TablaWrap,
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
    /** Nombre del Project Manager del proyecto (columna PM). */
    pm: string;
    fecha_prometida: string | null;
    dias_restantes: number | null;
    /** Tiempo laboral acumulado en el estado actual (columna "En estado"). */
    tiempo_en_estado_ms: number | null;
    motivo: string;
    semaforo: "vencido" | "critico" | "en_riesgo";
  }[];
  proyectos_periodo: (Data["criticos"][number] & {
    estado_id: string | null;
    responsable_tecnico_id: string | null;
    entregado: boolean;
    demorado: boolean;
    buckets: KpiBucket[];
  })[];
  estados_periodo: {
    estado_id: string;
    nombre: string;
    color: string;
    cantidad: number;
    demorados: number;
    umbral_horas: number | null;
  }[];
  total_activos: number;
  demorados_total: number;
  tecnicos_resumen: { usuario_id: string; nombre: string; total: number }[];
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
  | { kind: "tecnico"; id: string }
  | null;

/** ¿Dos selecciones son la misma? Para que apretar lo ya activo lo apague. */
function mismaSel(a: Sel, b: Sel): boolean {
  if (a == null || b == null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "kpi" && b.kind === "kpi") return a.bucket === b.bucket;
  if (a.kind === "estado" && b.kind === "estado") return a.id === b.id;
  if (a.kind === "demorado" && b.kind === "demorado") return a.estadoId === b.estadoId;
  if (a.kind === "tecnico" && b.kind === "tecnico") return a.id === b.id;
  return false;
}

/** Columnas por las que se puede ordenar la tabla de proyectos. */
type OrdenCol =
  | "titulo"
  | "cliente"
  | "estado_nombre"
  | "tecnico"
  | "pm"
  | "fecha_prometida"
  | "tiempo_en_estado_ms";

/**
 * Compara dos filas por una columna, ya con la dirección aplicada. Los vacíos
 * (sin fecha / sin tiempo) van SIEMPRE al final, ordene como ordene, para que
 * "—" no se mezcle con los datos reales.
 */
function cmpOrden(
  a: Data["criticos"][number],
  b: Data["criticos"][number],
  col: OrdenCol,
  dir: "asc" | "desc"
): number {
  const mul = dir === "asc" ? 1 : -1;
  if (col === "tiempo_en_estado_ms") {
    const av = a.tiempo_en_estado_ms;
    const bv = b.tiempo_en_estado_ms;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * mul;
  }
  if (col === "fecha_prometida") {
    const av = a.fecha_prometida ? Date.parse(a.fecha_prometida) : Number.NaN;
    const bv = b.fecha_prometida ? Date.parse(b.fecha_prometida) : Number.NaN;
    const an = Number.isNaN(av);
    const bn = Number.isNaN(bv);
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    return (av - bv) * mul;
  }
  return String(a[col] ?? "").localeCompare(String(b[col] ?? ""), "es", { sensitivity: "base" }) * mul;
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
   * La lista de abajo: por defecto TODOS los proyectos del período (activos +
   * entregados); con una tarjeta seleccionada, sólo los de ese recorte. Las
   * señales de riesgo (kpi/demorado) filtran sólo lo vivo, porque los entregados
   * traen buckets vacío y demorado=false.
   */
  const filasLista = useMemo(() => {
    if (!data) return [];
    const act = data.proyectos_periodo;
    if (!sel) return act;
    if (sel.kind === "kpi") return act.filter((p) => p.buckets.includes(sel.bucket));
    if (sel.kind === "estado") return act.filter((p) => p.estado_id === sel.id);
    if (sel.kind === "tecnico") return act.filter((p) => p.responsable_tecnico_id === sel.id);
    // demorado
    return act.filter((p) => p.demorado && (sel.estadoId ? p.estado_id === sel.estadoId : true));
  }, [data, sel]);

  /** Título de la lista según qué se está mirando. */
  const tituloLista = useMemo(() => {
    if (!sel) return "Proyectos del período";
    if (sel.kind === "kpi") return KPI_LABEL[sel.bucket];
    if (sel.kind === "estado") {
      return data?.estados_periodo.find((e) => e.estado_id === sel.id)?.nombre ?? "Estado";
    }
    if (sel.kind === "tecnico") {
      const n = data?.tecnicos_resumen.find((t) => t.usuario_id === sel.id)?.nombre;
      return n ? nombreCapitular(n) : "Programador";
    }
    if (sel.estadoId) {
      const n = data?.estados_periodo.find((e) => e.estado_id === sel.estadoId)?.nombre;
      return `Demorados · ${n ?? "estado"}`;
    }
    return "Demorados";
  }, [sel, data]);

  /**
   * Orden de la tabla. `null` = orden por prioridad (el que arma el backend).
   * Al clickear un encabezado se ordena por esa columna; volver a clickear
   * invierte. El texto va A→Z; el tiempo y la fecha arrancan de mayor a menor.
   */
  const [orden, setOrden] = useState<{ col: OrdenCol; dir: "asc" | "desc" } | null>(null);
  /** Para saltar a la tabla al elegir un programador (las cards están abajo). */
  const tablaRef = useRef<HTMLDivElement>(null);
  const clickOrden = useCallback((col: OrdenCol) => {
    setOrden((prev) => {
      if (prev?.col === col) return { col, dir: prev.dir === "asc" ? "desc" : "asc" };
      const numerica = col === "tiempo_en_estado_ms" || col === "fecha_prometida";
      return { col, dir: numerica ? "desc" : "asc" };
    });
  }, []);

  const filasOrdenadas = useMemo(() => {
    if (!orden) return filasLista;
    return [...filasLista].sort((a, b) => cmpOrden(a, b, orden.col, orden.dir));
  }, [filasLista, orden]);

  /** Encabezado clickeable con la flechita de orden. */
  const th = (label: string, col: OrdenCol, extra = "pr-2") => {
    const activo = orden?.col === col;
    return (
      <th className={`pb-1.5 font-medium ${extra}`}>
        <button
          type="button"
          onClick={() => clickOrden(col)}
          className="inline-flex items-center gap-1 transition-colors hover:text-slate-600"
          title="Ordenar por esta columna"
        >
          {label}
          <span className={activo ? "text-[#4FAEB2]" : "text-slate-300"}>
            {activo ? (orden.dir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  };

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
              {data.estados_periodo.length === 0 ? (
                <p className="text-sm text-slate-400">Sin proyectos activos</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {data.estados_periodo.map((e) => {
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

            {/* Tabla de proyectos activos (a todo el ancho) */}
            <div ref={tablaRef} className="space-y-3">
              <Card>
                <CardTitle
                  right={
                    sel ? (
                      <button
                        type="button"
                        onClick={() => setSel(null)}
                        className="whitespace-nowrap text-[11px] font-medium text-[#4FAEB2] hover:underline"
                      >
                        ← Ver todos
                      </button>
                    ) : (
                      <Link
                        href="/dashboard/proyectos"
                        className="whitespace-nowrap text-[11px] font-medium text-[#4FAEB2] hover:underline"
                      >
                        Abrir en Proyectos →
                      </Link>
                    )
                  }
                >
                  <span className="flex items-center gap-1.5">
                    {tituloLista}
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                      {filasLista.length}
                    </span>
                  </span>
                </CardTitle>
                {filasLista.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {sel ? "Sin proyectos en esta selección." : "No hay proyectos en el período."}
                  </p>
                ) : (
                  <TablaWrap>
                    <table className="w-full min-w-[680px] text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                          {th("Proyecto", "titulo")}
                          {th("Cliente", "cliente")}
                          {th("Estado", "estado_nombre")}
                          {th("Técnico", "tecnico")}
                          {th("Prometida", "fecha_prometida")}
                          {th("PM", "pm")}
                          {th("En estado", "tiempo_en_estado_ms", "")}
                        </tr>
                      </thead>
                      <tbody>
                        {filasOrdenadas.map((c) => (
                          <tr
                            key={c.id}
                            className={`border-b border-slate-50 text-[11px] last:border-0 ${
                              c.entregado ? "opacity-55" : ""
                            }`}
                          >
                            <td className="max-w-[150px] truncate py-1.5 pr-2 font-medium text-slate-700">
                              <Link href={`/dashboard/proyectos?proyecto=${c.id}&from=tablero`} className="hover:underline" title={c.titulo}>
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
                            <td className="max-w-[120px] truncate py-1.5 pr-2 text-slate-500" title={c.pm}>
                              {c.pm && c.pm !== "—" ? nombreCorto(c.pm) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="whitespace-nowrap py-1.5 tabular-nums font-semibold text-slate-600">
                              {fmtDur(c.tiempo_en_estado_ms)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TablaWrap>
                )}
              </Card>
            </div>

            {/* Por programador — nombre + total de proyectos del período
                (activos + entregados, sin cancelados). Por ahora sólo el total:
                después le damos vida (click para filtrar, más métricas). */}
            <Card>
              <CardTitle>Por programador</CardTitle>
              {data.tecnicos_resumen.length === 0 ? (
                <p className="text-sm text-slate-400">Sin programadores con proyectos.</p>
              ) : (
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}
                >
                  {data.tecnicos_resumen.map((t) => (
                    <Kpi
                      key={t.usuario_id}
                      icon={UsersRound}
                      tono={TONO.teal}
                      label={nombreCapitular(t.nombre)}
                      numero={t.total}
                      pie="proyectos"
                      onClick={() => {
                        toggleSel({ kind: "tecnico", id: t.usuario_id });
                        tablaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      seleccionado={sel?.kind === "tecnico" && sel.id === t.usuario_id}
                    />
                  ))}
                </div>
              )}
            </Card>

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
