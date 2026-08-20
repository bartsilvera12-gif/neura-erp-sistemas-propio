"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  FolderKanban,
  PackageCheck,
  Receipt,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import CountUp from "@/components/reactbits/CountUp";
import SpotlightCard from "@/components/reactbits/SpotlightCard";

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
  por_tecnico: { tecnico: string; cantidad: number; presupuesto: number; deuda: number; proyectos: DetalleProy[] }[];
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
  deuda: number;
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

/**
 * Monto compacto para el número grande de una tarjeta KPI: `₲184,4M` en vez de
 * `₲ 184.440.000`. El monto completo (con miles) sigue en las tablas de
 * detalle vía `fmtGs` — ahí hay una columna entera para leerlo; acá el número
 * es lo único grande en la tarjeta y tiene que entrar en una línea.
 */
function fmtGsCompacto(n: number): string {
  const { valor, unidad } = partesGsCompacto(n);
  return `₲${valor.toFixed(unidad ? 1 : 0).replace(".", ",")}${unidad}`;
}

/**
 * Igual que `fmtGsCompacto` pero devuelve el número y su unidad por separado,
 * para poder animar sólo la cifra con CountUp y dejar el sufijo ("M", "MM")
 * quieto al lado. Animar el string entero haría parpadear la unidad.
 */
function partesGsCompacto(n: number): { valor: number; unidad: string; decimales: number } {
  const v = Math.abs(n || 0);
  if (v >= 1e9) return { valor: Math.round((n / 1e9) * 10) / 10, unidad: "MM", decimales: 1 };
  if (v >= 1e6) return { valor: Math.round((n / 1e6) * 10) / 10, unidad: "M", decimales: 1 };
  if (v >= 1e3) return { valor: Math.round(n / 1e3), unidad: "K", decimales: 0 };
  return { valor: n || 0, unidad: "", decimales: 0 };
}

/**
 * Avatares en tinte suave (fondo lavado + tinta oscura del mismo hue) en vez de
 * relleno saturado. Mantienen la identidad de cada persona, pero dejan de
 * competir con las barras: en un ranking el color que tiene que llamar la
 * atención es el del dato, no el de la inicial.
 */
const AVATAR_PALETTE = [
  "bg-[#4FAEB2]/15 text-[#2F6E71]",
  "bg-violet-500/15 text-violet-700",
  "bg-amber-500/20 text-amber-700",
  "bg-emerald-600/15 text-emerald-700",
  "bg-rose-500/15 text-rose-700",
  "bg-sky-600/15 text-sky-700",
  "bg-indigo-500/15 text-indigo-700",
  "bg-fuchsia-500/15 text-fuchsia-700",
];

function avatarClass(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function iniciales(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Los nombres vienen en MAYÚSCULAS desde la base. En un listado de 5 filas eso
 * grita y además es más lento de leer; se muestran en capitular. Las partículas
 * ("de", "del", "da"…) quedan en minúscula como en un nombre bien escrito.
 */
const PARTICULAS_NOMBRE = new Set(["de", "del", "la", "las", "los", "da", "do", "dos", "y", "e"]);

function nombreCapitular(name: string): string {
  const limpio = (name ?? "").trim();
  if (!limpio) return "—";
  // Si ya viene en mixto (no está todo en mayúsculas) se respeta tal cual.
  if (limpio !== limpio.toUpperCase()) return limpio;
  return limpio
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && PARTICULAS_NOMBRE.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

type MetricaMonto = "presupuesto" | "deuda";

/**
 * Color de la sección "Por técnico". El switch muestra UNA sola medida a la vez,
 * así que cada vista es una serie única: un solo hue de magnitud, no una paleta
 * categórica. Ambos superan 3:1 sobre el blanco de la tarjeta (validado con el
 * script de paleta). Deliberadamente NO se usa el rojo de estado crítico para la
 * deuda: en un reporte gerencial el rojo dice "emergencia", y acá el número es
 * una magnitud a comparar, no una alarma. El ámbar lee como "pendiente" sin
 * teñir de urgencia a todo el equipo.
 */
const METRICA_META: Record<MetricaMonto, { label: string; color: string; totalLabel: string; nota: string }> = {
  presupuesto: {
    label: "Monto",
    color: "#3F8E91",
    totalLabel: "Monto total",
    nota: "Venta cerrada del cliente (primera factura), atribuida una sola vez al proyecto más antiguo de ese cliente.",
  },
  deuda: {
    label: "Deuda",
    color: "#B45309",
    totalLabel: "Deuda total",
    nota: "Saldo pendiente de las facturas de venta del cliente, atribuido una sola vez al proyecto más antiguo de ese cliente.",
  },
};

/** Tabla de proyectos de un responsable (etapa, vendedor, presupuesto o deuda, SLA). */
function ProyectosDetalleTabla({
  proyectos,
  mostrarVendedor = false,
  metrica = "presupuesto",
}: {
  proyectos: DetalleProy[];
  mostrarVendedor?: boolean;
  metrica?: MetricaMonto;
}) {
  if (!proyectos.length) return <p className="px-3 py-3 text-xs text-slate-400">Sin proyectos.</p>;
  const etiquetaMonto = metrica === "deuda" ? "Deuda" : "Presupuesto";
  // Mismo hue que la barra de la fila que abrió esta tabla, para que el detalle
  // no cambie de color respecto del resumen.
  const tonoMonto = METRICA_META[metrica].color;
  const cols = mostrarVendedor
    ? ["Cliente / Proyecto", "Etapa", "Vendedor", etiquetaMonto, "SLA"]
    : ["Cliente / Proyecto", "Etapa", etiquetaMonto, "SLA"];
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
          {proyectos.map((p) => {
            const monto = metrica === "deuda" ? p.deuda : p.presupuesto;
            return (
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
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums" style={{ color: tonoMonto }}>
                  {monto > 0 ? fmtGs(monto) : <span className="text-slate-300">—</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-[11px]">
                  <span className={p.sla_vencido ? "font-semibold text-rose-600" : "text-slate-400"}>{p.sla_texto}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {proyectos.some((p) => (metrica === "deuda" ? p.deuda : p.presupuesto) <= 0) ? (
        <p className="px-3 py-1.5 text-[10px] text-slate-400">
          {metrica === "deuda"
            ? "“—” = sin saldo pendiente atribuido (cliente sin deuda, o ya contada en otro proyecto del mismo cliente)."
            : "“—” = sin presupuesto atribuido (cliente sin factura, o ya contado en otro proyecto del mismo cliente)."}
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

type KpiTono = "neutral" | "money" | "ok" | "danger";

/**
 * El tono pinta el ÍCONO, no el número. El valor va siempre en tinta: seis
 * tarjetas con seis números de colores distintos compiten entre sí y ninguna
 * termina destacando. La excepción es `danger`, que es un estado real (SLA
 * vencido) y ahí el rojo sí está diciendo algo — y aun así viene acompañado de
 * ícono y etiqueta, nunca color solo.
 */
const KPI_TONOS: Record<KpiTono, { chip: string; value: string; spot: `rgba(${number}, ${number}, ${number}, ${number})` }> = {
  neutral: { chip: "bg-slate-100 text-slate-500", value: "text-slate-900", spot: "rgba(100, 116, 139, 0.10)" },
  money: { chip: "bg-[#4FAEB2]/10 text-[#3F8E91]", value: "text-slate-900", spot: "rgba(79, 174, 178, 0.16)" },
  ok: { chip: "bg-emerald-50 text-emerald-600", value: "text-slate-900", spot: "rgba(16, 185, 129, 0.14)" },
  danger: { chip: "bg-rose-50 text-rose-600", value: "text-rose-700", spot: "rgba(225, 29, 72, 0.14)" },
};

/**
 * Tarjeta KPI: ícono (identidad, no depende del color) + etiqueta ómnibus +
 * número grande + dato secundario opcional.
 *
 * El número NO lleva `tabular-nums`: esa es la opción correcta para columnas
 * que tienen que alinear dígito contra dígito (las tablas de abajo sí la
 * llevan), pero en un número grande y solo hace que se vea más suelto de lo
 * normal. Acá se usan las cifras proporcionales por defecto de la tipografía.
 *
 * `count` anima la cifra al entrar; `prefijo`/`unidad` quedan fijos a los
 * costados para que sólo se mueva el número.
 */
function Kpi({
  icon: Icon,
  label,
  count,
  prefijo,
  unidad,
  sub,
  tono = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  prefijo?: string;
  unidad?: string;
  sub?: string;
  tono?: KpiTono;
}) {
  const t = KPI_TONOS[tono];
  return (
    <SpotlightCard
      spotlightColor={t.spot}
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.chip}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {label}
        </p>
      </div>
      <p className={`mt-2.5 flex items-baseline text-2xl font-bold leading-none ${t.value}`}>
        {prefijo ? <span className="mr-0.5 text-base font-semibold text-slate-400">{prefijo}</span> : null}
        <CountUp to={count} duration={0.9} separator="." />
        {unidad ? <span className="ml-0.5 text-base font-semibold text-slate-400">{unidad}</span> : null}
      </p>
      {sub ? <p className="mt-1.5 text-[11px] text-slate-500">{sub}</p> : null}
    </SpotlightCard>
  );
}

/**
 * Barra de magnitud. Fina y con extremos redondeados; el riel gris es el 100 %
 * de referencia para que dos filas se puedan comparar de un vistazo.
 */
function Bar({
  value,
  max,
  color = "#4FAEB2",
  montada = true,
}: {
  value: number;
  max: number;
  color?: string;
  montada?: boolean;
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: montada ? `${pct}%` : "0%", background: color }}
      />
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
  const [tecMetrica, setTecMetrica] = useState<MetricaMonto>("presupuesto"); // "Por técnico": Presupuesto vs Deuda

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
  // "Por asesor": mismo criterio que "Por técnico" — ranking por la magnitud que
  // se está mostrando, para que las barras bajen de mayor a menor.
  const asesoresOrdenados = [...data.por_asesor].sort(
    (a, b) => b.presupuesto - a.presupuesto || b.cantidad - a.cantidad
  );
  const maxAsePres = Math.max(1, ...asesoresOrdenados.map((a) => a.presupuesto));
  const totalAsePresupuesto = asesoresOrdenados.reduce((acc, a) => acc + a.presupuesto, 0);
  const totalAseProyectos = asesoresOrdenados.reduce((acc, a) => acc + a.cantidad, 0);
  // "Por técnico": el ranking sigue SIEMPRE a la medida activa del switch, así
  // las barras bajan de mayor a menor y la lista se lee de un vistazo. (Antes
  // ordenaba por cantidad de proyectos y las barras quedaban desordenadas.)
  const tecMetricaMeta = METRICA_META[tecMetrica];
  const montoTecnico = (t: { presupuesto: number; deuda: number }) =>
    tecMetrica === "deuda" ? t.deuda : t.presupuesto;
  const tecnicosOrdenados = [...data.por_tecnico].sort(
    (a, b) => montoTecnico(b) - montoTecnico(a) || b.cantidad - a.cantidad
  );
  const maxTecMetrica = Math.max(1, ...tecnicosOrdenados.map(montoTecnico));
  const totalTecMetrica = tecnicosOrdenados.reduce((a, t) => a + montoTecnico(t), 0);
  const totalTecProyectos = tecnicosOrdenados.reduce((a, t) => a + t.cantidad, 0);
  const maxMesCant = Math.max(
    1,
    ...data.entregados_por_mes.flatMap((m) => [m.web.cantidad, m.saas.cantidad, m.mixto.cantidad])
  );
  const hayMixtos = data.entregados_por_mes.some((m) => m.mixto.cantidad > 0);
  const maxRubro = Math.max(1, ...data.por_rubro.map((r) => r.cantidad));
  const maxTipoCant = Math.max(1, ...data.por_tipo.map((t) => t.cantidad));

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        Vista completa — <span className="font-medium">todos los proyectos</span> activos (sin filtro por mes).
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={FolderKanban} label="Proyectos" count={data.kpis.total} sub={`${data.kpis.en_curso} en curso`} />
        <Kpi
          icon={PackageCheck}
          label="Entregados (mes)"
          count={data.kpis.entregados_mes}
          sub={fmtGsCompacto(data.kpis.entregados_mes_monto)}
          tono="ok"
        />
        <Kpi
          icon={Wallet}
          label="Presupuesto"
          count={partesGsCompacto(data.kpis.presupuesto_total).valor}
          prefijo="₲"
          unidad={partesGsCompacto(data.kpis.presupuesto_total).unidad}
          sub={`${data.kpis.con_presupuesto}/${data.kpis.total} con factura`}
          tono="money"
        />
        <Kpi
          icon={Receipt}
          label="Ticket promedio"
          count={partesGsCompacto(data.kpis.ticket_promedio).valor}
          prefijo="₲"
          unidad={partesGsCompacto(data.kpis.ticket_promedio).unidad}
          tono="money"
        />
        <Kpi
          icon={data.kpis.sla_vencidos > 0 ? AlertTriangle : CheckCircle2}
          label="SLA vencidos"
          count={data.kpis.sla_vencidos}
          sub={data.kpis.sla_vencidos > 0 ? "revisar ahora" : "todo al día"}
          tono={data.kpis.sla_vencidos > 0 ? "danger" : "ok"}
        />
        <Kpi icon={Activity} label="En curso" count={data.kpis.en_curso} sub="no entregados" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Por estado</h2>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Todos los proyectos activos, en el orden del pipeline.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                {["Estado", "Proy.", "", "Presupuesto", "SLA vencidos"].map((h, i) => (
                  <th
                    key={i}
                    className={`px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 ${
                      i === 0 || i === 2 ? "text-left" : "text-right"
                    }`}
                  >
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
                    {e.es_final ? (
                      <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                        final
                      </span>
                    ) : null}
                  </td>
                  <td className="w-14 px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{e.cantidad}</td>
                  <td className="w-[28%] px-3 py-2.5">
                    <Bar
                      value={e.cantidad}
                      max={maxEstadoCant}
                      montada={barrasMontadas}
                    />
                  </td>
                  {/* Importe en tinta: la magnitud ya la cuenta la barra de al lado. */}
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{fmtGs(e.presupuesto)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {e.sla_configurado ? (
                      <span className={e.sla_vencidos > 0 ? "font-semibold text-rose-600" : "text-slate-400"}>
                        {e.sla_vencidos}
                      </span>
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Por asesor comercial</h2>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Carga vigente: activos + entregados este mes. Tocá un asesor para ver sus proyectos.
        </p>
        {data.por_asesor.length === 0 ? (
          <p className="mt-4 text-xs text-slate-400">Sin proyectos con asesor asignado.</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#3F8E91]" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Presupuesto total
                  </span>
                </div>
                <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-slate-900">
                  <span className="mr-1 text-lg font-medium text-slate-400">₲</span>
                  <CountUp to={totalAsePresupuesto} duration={0.9} separator="." />
                </p>
              </div>
              <p className="text-right text-[11px] leading-relaxed text-slate-500">
                {data.por_asesor.length} asesor{data.por_asesor.length === 1 ? "" : "es"} · {totalAseProyectos} proyecto
                {totalAseProyectos === 1 ? "" : "s"}
              </p>
            </div>

            <div className="mt-3 divide-y divide-slate-100">
              {asesoresOrdenados.map((a, i) => {
                const open = aseAbierto === a.asesor;
                const share = totalAsePresupuesto > 0 ? (a.presupuesto / totalAsePresupuesto) * 100 : 0;
                const ancho = maxAsePres > 0 ? Math.max(a.presupuesto > 0 ? 2 : 0, (a.presupuesto / maxAsePres) * 100) : 0;
                return (
                  <div key={a.asesor} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setAseAbierto(open ? null : a.asesor)}
                      aria-expanded={open}
                      className={`group w-full rounded-lg px-2 py-2 text-left transition-colors ${
                        open ? "bg-slate-50" : "hover:bg-slate-50/70"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-4 shrink-0 text-right text-[10px] font-medium tabular-nums text-slate-300">
                          {i + 1}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${avatarClass(a.asesor)}`}
                        >
                          {iniciales(a.asesor)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">
                          {nombreCapitular(a.asesor)}
                        </span>
                        <div className="hidden h-1.5 w-[150px] shrink-0 overflow-hidden rounded-full bg-slate-100 md:block lg:w-[200px]">
                          <div
                            className="h-full rounded-full transition-[width] duration-700 ease-out"
                            style={{ width: barrasMontadas ? `${ancho}%` : "0%", background: "#3F8E91" }}
                          />
                        </div>
                        <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                          {share.toFixed(1).replace(".", ",")}%
                        </span>
                        <span className="hidden w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-400 sm:block">
                          {a.cantidad} proy
                        </span>
                        <span className="w-28 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-900">
                          {fmtGs(a.presupuesto)}
                        </span>
                      </div>
                    </button>
                    {open ? (
                      <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <ProyectosDetalleTabla proyectos={a.proyectos} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Por técnico</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Carga vigente: activos + entregados este mes. Tocá un técnico para ver sus proyectos.
            </p>
          </div>
          {/*
            Control segmentado: la pastilla activa es blanca sobre riel gris y el
            color de la medida viaja en un punto, no tiñendo todo el botón. Así el
            único elemento saturado de la fila sigue siendo el dato.
          */}
          <div
            role="tablist"
            aria-label="Medida a mostrar"
            className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100/70 p-0.5"
          >
            {(["presupuesto", "deuda"] as MetricaMonto[]).map((m) => {
              const activo = tecMetrica === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={activo}
                  onClick={() => setTecMetrica(m)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all ${
                    activo
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full transition-colors"
                    style={{ background: activo ? METRICA_META[m].color : "#cbd5e1" }}
                  />
                  {METRICA_META[m].label}
                </button>
              );
            })}
          </div>
        </div>

        {data.por_tecnico.length === 0 ? (
          <p className="mt-4 text-xs text-slate-400">Sin proyectos con técnico asignado.</p>
        ) : (
          <>
            {/*
              Total de la medida activa. Es la cifra que se lee primero en una
              revisión gerencial, así que va sola y en grande, con figuras
              proporcionales (no tabulares: eso se reserva para las columnas que
              tienen que alinearse). El `key` fuerza que el contador vuelva a
              correr al cambiar de medida.
            */}
            <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ background: tecMetricaMeta.color }}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    {tecMetricaMeta.totalLabel}
                  </span>
                </div>
                <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-slate-900">
                  <span className="mr-1 text-lg font-medium text-slate-400">₲</span>
                  <CountUp key={tecMetrica} to={totalTecMetrica} duration={0.9} separator="." />
                </p>
              </div>
              <p className="text-right text-[11px] leading-relaxed text-slate-500">
                {tecnicosOrdenados.length} técnico{tecnicosOrdenados.length === 1 ? "" : "s"} ·{" "}
                {totalTecProyectos} proyecto{totalTecProyectos === 1 ? "" : "s"}
              </p>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{tecMetricaMeta.nota}</p>

            <div className="mt-3 divide-y divide-slate-100">
              {tecnicosOrdenados.map((t, i) => {
                const open = tecAbierto === t.tecnico;
                const monto = montoTecnico(t);
                const share = totalTecMetrica > 0 ? (monto / totalTecMetrica) * 100 : 0;
                const ancho = maxTecMetrica > 0 ? Math.max(monto > 0 ? 2 : 0, (monto / maxTecMetrica) * 100) : 0;
                return (
                  <div key={t.tecnico} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setTecAbierto(open ? null : t.tecnico)}
                      aria-expanded={open}
                      className={`group w-full rounded-lg px-2 py-2 text-left transition-colors ${
                        open ? "bg-slate-50" : "hover:bg-slate-50/70"
                      }`}
                    >
                      {/*
                        Una sola línea con columnas alineadas: nombre a la
                        izquierda, barra en un ancho FIJO y las cifras en
                        columnas tabulares a la derecha. La barra acotada se lee
                        como gráfico; estirada a todo el ancho se leía como un
                        subrayado y le ganaba en peso visual al número.
                      */}
                      <div className="flex items-center gap-3">
                        <span className="w-4 shrink-0 text-right text-[10px] font-medium tabular-nums text-slate-300">
                          {i + 1}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${avatarClass(t.tecnico)}`}
                        >
                          {iniciales(t.tecnico)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">
                          {nombreCapitular(t.tecnico)}
                        </span>
                        <div className="hidden h-1.5 w-[150px] shrink-0 overflow-hidden rounded-full bg-slate-100 md:block lg:w-[200px]">
                          <div
                            className="h-full rounded-full transition-[width] duration-700 ease-out"
                            style={{
                              width: barrasMontadas ? `${ancho}%` : "0%",
                              background: tecMetricaMeta.color,
                            }}
                          />
                        </div>
                        <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                          {share.toFixed(1).replace(".", ",")}%
                        </span>
                        <span className="hidden w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-400 sm:block">
                          {t.cantidad} proy
                        </span>
                        {/*
                          El importe va en tinta, no en el color de la serie: el
                          color ya lo lleva la barra de la misma fila.
                        */}
                        <span className="w-28 shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-900">
                          {fmtGs(monto)}
                        </span>
                      </div>
                    </button>
                    {open ? (
                      <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <ProyectosDetalleTabla proyectos={t.proyectos} mostrarVendedor metrica={tecMetrica} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Por tipo</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Proyectos y presupuesto según el tipo contratado.</p>
          {/*
            Antes era una lista de texto sin nada que comparar. La barra de
            cantidad hace visible de una cuál tipo pesa más; el importe sigue a
            la derecha, en tinta y en columna tabular.
          */}
          <div className="mt-3 divide-y divide-slate-100">
            {data.por_tipo.map((t) => (
              <div key={t.tipo} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{t.tipo}</span>
                <div className="hidden h-1.5 w-[90px] shrink-0 overflow-hidden rounded-full bg-slate-100 sm:block">
                  <div
                    className="h-full rounded-full bg-[#4FAEB2] transition-[width] duration-700 ease-out"
                    style={{
                      width: barrasMontadas
                        ? `${maxTipoCant > 0 ? Math.max(t.cantidad > 0 ? 2 : 0, (t.cantidad / maxTipoCant) * 100) : 0}%`
                        : "0%",
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-[12px] font-semibold tabular-nums text-slate-900">
                  {t.cantidad}
                </span>
                <span className="w-28 shrink-0 text-right text-[12px] font-semibold tabular-nums text-slate-900">
                  {fmtGs(t.presupuesto)}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Por rubro (web)</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Los 10 rubros con más proyectos web.</p>
          <div className="mt-3 divide-y divide-slate-100">
            {data.por_rubro.slice(0, 10).map((r) => (
              <div key={r.rubro} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{r.rubro}</span>
                <div className="h-1.5 w-[110px] shrink-0 overflow-hidden rounded-full bg-slate-100 sm:w-[150px]">
                  <div
                    className="h-full rounded-full bg-[#4FAEB2] transition-[width] duration-700 ease-out"
                    style={{
                      width: barrasMontadas
                        ? `${maxRubro > 0 ? Math.max(r.cantidad > 0 ? 2 : 0, (r.cantidad / maxRubro) * 100) : 0}%`
                        : "0%",
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-[12px] font-semibold tabular-nums text-slate-900">
                  {r.cantidad}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                    Entregados en {mesLabel(mesSel)} · {mes.cantidad} · <span className="text-slate-900">{fmtGs(mes.monto)}</span>
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
                            <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{fmtGs(p.monto)}</td>
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
