"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/** Agregado de plata por tipo de servicio (lo entrega el API, ya calculado desde facturas/pagos). */
type Agg = {
  facturado_mes: number; // emitido este mes en cuotas de suscripción
  facturado_mes_ant: number; // idem mes anterior (tendencia)
  facturas_mes: number; // cantidad de cuotas emitidas este mes
  cobrado_mes: number; // CAJA de suscripciones este mes (cualquier mes de emisión)
  cobrado_mes_ant: number; // caja mismo tramo del mes anterior (tendencia)
  por_cobrar_total: number; // DEUDA total: todas las cuotas impagas, de cualquier mes
  cuotas_impagas: number; // cantidad de cuotas con saldo pendiente
};
type TipoAgg = Agg & { label: string };
const emptyAgg = (): Agg => ({
  facturado_mes: 0,
  facturado_mes_ant: 0,
  facturas_mes: 0,
  cobrado_mes: 0,
  cobrado_mes_ant: 0,
  por_cobrar_total: 0,
  cuotas_impagas: 0,
});

type SortCol = "mensual" | "cobrado" | "adeudado";
type Row = {
  cliente: string;
  plan: string;
  tipo_slug: string | null;
  tipo_label: string;
  monto: number; // cuota mensual
  facturado_mes: number; // cuota emitida este mes (0 si no se emitió / anulada)
  saldo_mes: number; // saldo de la cuota de este mes
  cobrado_mes: number; // caja de esta sub este mes (cualquier mes de emisión)
  adeudado_total: number; // deuda total de esta sub (todas las cuotas impagas)
  anulada_mes: boolean;
  moneda: string;
  vendedor: string;
};
type SeriePunto = { periodo: string; label: string; monto: number };

/** Estado del cliente respecto de su deuda de suscripción: al día (no debe) o debe (tiene saldo). */
type EstadoDeuda = "al_dia" | "debe";
const estadoDeuda = (r: Row): EstadoDeuda => ((r.adeudado_total || 0) > 0 ? "debe" : "al_dia");

function fmtGs(n: number) {
  return n.toLocaleString("es-PY");
}

/** Clave para agrupar/filtrar los clientes sin tipo de servicio cargado (coincide con el API). */
const SIN_TIPO = "__sin_tipo__";

function periodoLabel(ym: string) {
  const [y, m] = ym.split("-");
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const mi = parseInt(m ?? "", 10);
  return mi >= 1 && mi <= 12 ? `${meses[mi - 1]} ${y}` : ym;
}

/** Iniciales del cliente para el avatar (1-2 letras). */
function iniciales(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function EstadoBadge({ estado }: { estado: EstadoDeuda }) {
  const cfg =
    estado === "debe"
      ? { cls: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500", label: "Debe" }
      : { cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Al día" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/** Tendencia del facturado (área + línea) a partir de la serie de meses. */
function TrendChart({ serie }: { serie: SeriePunto[] }) {
  const W = 520;
  const H = 150;
  const PAD = 10;
  const TOP = 16;
  if (serie.length === 0) return <div className="h-[150px]" />;
  const vals = serie.map((p) => p.monto);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const n = serie.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * (W - 2 * PAD) + PAD);
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD - TOP);
  const pts = serie.map((p, i) => [x(i), y(p.monto)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" preserveAspectRatio="none" role="img" aria-label="Tendencia del facturado mensual">
        <defs>
          <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4FAEB2" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#4FAEB2" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={H - PAD} x2={W} y2={H - PAD} stroke="#eef2f5" strokeWidth="1" />
        <line x1="0" y1={(H + TOP) / 2} x2={W} y2={(H + TOP) / 2} stroke="#f1f5f9" strokeWidth="1" />
        <path d={area} fill="url(#mrrFill)" />
        <path d={line} fill="none" stroke="#3F8E91" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === n - 1 ? 5.5 : 3.5} fill={i === n - 1 ? "#3F8E91" : "#4FAEB2"} stroke="#fff" strokeWidth={i === n - 1 ? 2.5 : 0} />
        ))}
      </svg>
      <div className="mt-1 flex justify-between px-1 text-[11px] font-semibold text-slate-400">
        {serie.map((p, i) => (
          <span key={p.periodo} className={i === n - 1 ? "text-[#3F8E91]" : ""}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Anillo de progreso (cobrado del mes vs emitido del mes). El % puede pasar 100 si se cobraron
 *  atrasados; el arco se topa en 100 pero el número muestra el valor real. */
function Ring({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct / 100)) * c;
  return (
    <div className="relative h-[150px] w-[150px]">
      <svg viewBox="0 0 120 120" className="h-[150px] w-[150px] -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#eef2f5" strokeWidth="14" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="#059669" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[28px] font-extrabold text-emerald-700">{pct}%</span>
      </div>
    </div>
  );
}

function DeltaChip({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-xs font-extrabold ${up ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
      </svg>
      {Math.abs(pct).toFixed(1).replace(".", ",")}%
    </span>
  );
}

/** Encabezado de columna ordenable: clic cicla desc → asc → default. */
function SortHeader({ label, col, orden, onSort, align = "left" }: {
  label: string;
  col: SortCol;
  orden: { col: SortCol | null; dir: "asc" | "desc" };
  onSort: (col: SortCol) => void;
  align?: "left" | "right";
}) {
  const active = orden.col === col;
  return (
    <th className={`px-4 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""} rounded transition-colors hover:text-slate-800 ${active ? "text-[#3F8E91]" : ""}`}
        title="Ordenar"
      >
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={active ? "" : "opacity-30"}>
          {active && orden.dir === "asc" ? <path d="M6 15l6-6 6 6" /> : active ? <path d="M6 9l6 6 6-6" /> : <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />}
        </svg>
      </button>
    </th>
  );
}

export default function ReporteSuscripcionesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tiposAgg, setTiposAgg] = useState<Record<string, TipoAgg>>({});
  const [totales, setTotales] = useState<Agg>(emptyAgg());
  const [serie, setSerie] = useState<SeriePunto[]>([]);
  const [periodo, setPeriodo] = useState("");
  const [periodoAnterior, setPeriodoAnterior] = useState("");
  const [diaCorte, setDiaCorte] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tipo, setTipo] = useState("");
  const [q, setQ] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"" | "cobrado" | "por_cobrar">("");
  // Orden de la tabla por columna (clic cicla: desc → asc → default por deuda).
  const [orden, setOrden] = useState<{ col: SortCol | null; dir: "asc" | "desc" }>({ col: null, dir: "desc" });
  const toggleOrden = (col: SortCol) =>
    setOrden((p) => (p.col !== col ? { col, dir: "desc" } : p.dir === "desc" ? { col, dir: "asc" } : { col: null, dir: "desc" }));

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchWithSupabaseSession("/api/reportes/suscripciones", { cache: "no-store" });
        const json = (await res.json()) as {
          success?: boolean;
          data?: {
            periodo: string;
            periodo_anterior?: string;
            dia_corte?: number;
            serie_mrr?: SeriePunto[];
            tipos?: Record<string, TipoAgg>;
            totales?: Agg;
            rows: Row[];
          };
          error?: string;
        };
        if (!res.ok || json.success !== true || !json.data) throw new Error(json.error ?? `Error ${res.status}`);
        if (!cancel) {
          setRows(json.data.rows);
          setTiposAgg(json.data.tipos ?? {});
          setTotales(json.data.totales ?? emptyAgg());
          setSerie(json.data.serie_mrr ?? []);
          setPeriodo(json.data.periodo);
          setPeriodoAnterior(json.data.periodo_anterior ?? "");
          setDiaCorte(Number(json.data.dia_corte) || 0);
          setErr(null);
        }
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

  const tiposDisponibles = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.tipo_slug) m.set(r.tipo_slug, r.tipo_label);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  // KPIs de arriba: salen del AGREGADO por tipo que arma el API (facturas/pagos reales, completos).
  // El buscador filtra solo la tabla, no los totales del concepto.
  const agg: Agg = useMemo(() => {
    if (!tipo) return totales;
    return tiposAgg[tipo] ?? emptyAgg();
  }, [tipo, tiposAgg, totales]);

  const facturadoDelMes = agg.facturado_mes;
  const facturasCount = agg.facturas_mes;
  const cobradoMes = agg.cobrado_mes;
  const porCobrarTotal = agg.por_cobrar_total;
  const cuotasImpagas = agg.cuotas_impagas;
  const pctCobrado = facturadoDelMes > 0 ? Math.round((cobradoMes / facturadoDelMes) * 100) : 0;
  const deltaEmitido = agg.facturado_mes_ant > 0 ? ((facturadoDelMes - agg.facturado_mes_ant) / agg.facturado_mes_ant) * 100 : facturadoDelMes > 0 ? 100 : 0;
  const deltaCobrado = agg.cobrado_mes_ant > 0 ? ((cobradoMes - agg.cobrado_mes_ant) / agg.cobrado_mes_ant) * 100 : cobradoMes > 0 ? 100 : 0;

  // Base de la tabla: búsqueda + tipo seleccionado.
  const baseSinTipo = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.cliente} ${r.plan} ${r.vendedor} ${r.tipo_label}`.toLowerCase().includes(needle));
  }, [rows, q]);
  const baseFiltradas = useMemo(() => {
    if (!tipo) return baseSinTipo;
    if (tipo === SIN_TIPO) return baseSinTipo.filter((r) => !r.tipo_slug);
    return baseSinTipo.filter((r) => r.tipo_slug === tipo);
  }, [baseSinTipo, tipo]);

  // La tabla: base + filtro por estado (tiles), ordenada.
  const filtradas = useMemo(() => {
    let list = baseFiltradas;
    if (estadoFiltro === "cobrado") list = list.filter((r) => (r.cobrado_mes || 0) > 0);
    if (estadoFiltro === "por_cobrar") list = list.filter((r) => (r.adeudado_total || 0) > 0);
    const arr = [...list];
    const mul = orden.dir === "asc" ? 1 : -1;
    if (orden.col === "mensual") {
      arr.sort((a, b) => (a.monto - b.monto) * mul || a.cliente.localeCompare(b.cliente));
    } else if (orden.col === "cobrado") {
      arr.sort((a, b) => (a.cobrado_mes - b.cobrado_mes) * mul || a.cliente.localeCompare(b.cliente));
    } else if (orden.col === "adeudado") {
      arr.sort((a, b) => (a.adeudado_total - b.adeudado_total) * mul || a.cliente.localeCompare(b.cliente));
    } else {
      // Default: mayor deuda primero.
      arr.sort((a, b) => b.adeudado_total - a.adeudado_total || b.monto - a.monto || a.cliente.localeCompare(b.cliente));
    }
    return arr;
  }, [baseFiltradas, estadoFiltro, orden]);

  const gs = (r: Row) => r.moneda === "GS";

  // Distribución por tipo (conteo de activas) — siempre sobre todos los tipos, clickeable.
  const distribucion = useMemo(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const r of baseSinTipo) {
      const key = r.tipo_slug ?? SIN_TIPO;
      const label = r.tipo_slug ? r.tipo_label : "Sin clasificar";
      const prev = m.get(key) ?? { key, label, count: 0 };
      prev.count += 1;
      m.set(key, prev);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [baseSinTipo]);
  const hayCliSinTipo = useMemo(() => rows.some((r) => !r.tipo_slug), [rows]);
  const maxTipoCount = Math.max(1, ...distribucion.map((d) => d.count));
  const tonos = ["bg-gradient-to-r from-[#3F8E91] to-[#0B3A3D]", "bg-[#4FAEB2]", "bg-[#7DCFD2]", "bg-[#B6E3E4]", "bg-slate-300"];

  const toggleEstado = (e: "cobrado" | "por_cobrar") => setEstadoFiltro((prev) => (prev === e ? "" : e));

  const TILE = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-[#4FAEB2]/10";
  const LBL = "text-[11px] font-bold uppercase tracking-[0.13em] text-slate-400";
  const tipoLabelActual = !tipo ? "Todas" : tipo === SIN_TIPO ? "Sin clasificar" : tiposAgg[tipo]?.label ?? "—";

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 sm:p-6">
      {/* ── Encabezado ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link>
          <span>/</span>
          <span className="font-medium text-slate-700">Suscripciones</span>
        </div>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900">Suscripciones</h1>
        <p className="text-xs text-slate-500">
          Facturado y cobrado de{" "}
          <span className="font-semibold text-slate-700">{periodo ? periodoLabel(periodo) : "este mes"}</span>, y la deuda total de suscripciones{tipo ? <> · <span className="font-semibold text-[#3F8E91]">{tipoLabelActual}</span></> : null}.
        </p>
      </div>

      {err && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{err}</div>}

      {/* ── Bento hero ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Facturado del mes + tendencia (grande) */}
        <div className={`${TILE} lg:col-span-1 lg:row-span-2 flex flex-col`}>
          <div className="flex items-start justify-between">
            <span className={LBL}>Facturado del mes · Suscripciones</span>
            <span className="rounded-lg border border-[#4FAEB2]/25 bg-[#4FAEB2]/10 px-2 py-1 text-[11px] font-bold text-[#3F8E91]">6 meses</span>
          </div>
          <div className="mt-3 text-[34px] font-extrabold leading-none tracking-tight tabular-nums text-slate-900">Gs. {fmtGs(facturadoDelMes)}</div>
          <div className="mt-2 text-[11px] text-slate-400">{facturasCount} cuota{facturasCount === 1 ? "" : "s"} emitida{facturasCount === 1 ? "" : "s"}{periodo ? ` · ${periodoLabel(periodo)}` : ""}</div>
          <div className="mt-4 flex items-center gap-2">
            <DeltaChip pct={deltaEmitido} />
            <span className="text-[11px] text-slate-400">vs {periodoAnterior ? periodoLabel(periodoAnterior).split(" ")[0] : "mes ant."}</span>
          </div>
          <div className="mt-auto pt-4">
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Facturado por mes</p>
            <TrendChart serie={serie} />
          </div>
        </div>

        {/* Cobrado del mes (caja) — anillo vs lo emitido este mes */}
        <button
          type="button"
          onClick={() => toggleEstado("cobrado")}
          aria-pressed={estadoFiltro === "cobrado"}
          className={`${TILE} flex flex-col items-center text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${estadoFiltro === "cobrado" ? "!border-emerald-400 !ring-2 !ring-emerald-300" : ""}`}
        >
          <span className={`${LBL} self-start`}>Cobrado del mes · Caja</span>
          <div className="relative mt-1">
            <Ring pct={pctCobrado} />
            <div className="absolute inset-x-0 bottom-[42px] text-center text-[10.5px] font-semibold text-slate-400">al día {diaCorte}</div>
          </div>
          <div className="mt-1 text-lg font-extrabold tabular-nums text-emerald-700">Gs. {fmtGs(cobradoMes)}</div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">de Gs. {fmtGs(facturadoDelMes)} emitido</span>
            <DeltaChip pct={deltaCobrado} />
          </div>
        </button>

        {/* Por cobrar — DEUDA TOTAL (todas las cuotas impagas, cualquier mes) */}
        <button
          type="button"
          onClick={() => toggleEstado("por_cobrar")}
          aria-pressed={estadoFiltro === "por_cobrar"}
          className={`${TILE} flex flex-col justify-between text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${estadoFiltro === "por_cobrar" ? "!border-amber-400 !ring-2 !ring-amber-300" : ""}`}
        >
          <div>
            <span className={LBL}>Por cobrar · Total</span>
            <div className="mt-3 text-[28px] font-extrabold leading-none tracking-tight tabular-nums text-amber-700">Gs. {fmtGs(porCobrarTotal)}</div>
            <div className="mt-2 text-[11px] text-slate-400">{cuotasImpagas} cuota{cuotasImpagas === 1 ? "" : "s"} impaga{cuotasImpagas === 1 ? "" : "s"}</div>
          </div>
          <div className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
            Toda la deuda de suscripciones — de cualquier mes, no solo el actual.
          </div>
        </button>

        {/* Activas + distribución por tipo (clic filtra los KPIs; "activas" resetea) */}
        <div className={`${TILE} lg:col-span-2 flex items-center gap-6`}>
          <button
            type="button"
            onClick={() => { setTipo(""); setEstadoFiltro(""); }}
            title="Ver todas"
            className={`flex shrink-0 items-center gap-3 rounded-xl border-r border-slate-100 pr-6 text-left transition-opacity ${tipo ? "opacity-60 hover:opacity-100" : ""}`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B3A3D]/[0.06] text-[#0B3A3D]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>
            </span>
            <div>
              <div className="text-[30px] font-extrabold leading-none tabular-nums text-slate-900">{baseSinTipo.length}</div>
              <div className={`${LBL} mt-1`}>activas</div>
            </div>
          </button>
          <div className="flex flex-1 flex-col gap-1.5">
            {distribucion.slice(0, 5).map((d, i) => {
              const activo = tipo === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setTipo((p) => (p === d.key ? "" : d.key))}
                  className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors ${activo ? "bg-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]/30" : "hover:bg-slate-50"}`}
                >
                  <span className={`w-24 shrink-0 truncate text-xs font-semibold ${activo ? "text-[#3F8E91]" : "text-slate-700"}`}>{d.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${tonos[i] ?? "bg-slate-300"}`} style={{ width: `${Math.round((d.count / maxTipoCount) * 100)}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-extrabold tabular-nums text-slate-900">{d.count}</span>
                </button>
              );
            })}
            {distribucion.length === 0 && <span className="text-xs text-slate-400">Sin datos</span>}
          </div>
        </div>
      </div>

      {/* ── Filtros ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
        <input
          type="search"
          placeholder="Buscar por cliente, plan o vendedor…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="min-w-[160px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        >
          <option value="">Todos los tipos</option>
          {tiposDisponibles.map(([slug, label]) => (
            <option key={slug} value={slug}>{label}</option>
          ))}
          {hayCliSinTipo && <option value={SIN_TIPO}>Sin clasificar</option>}
        </select>
        {(q || tipo || estadoFiltro) && (
          <button
            onClick={() => { setQ(""); setTipo(""); setEstadoFiltro(""); }}
            className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Limpiar {estadoFiltro ? `· ${estadoFiltro === "cobrado" ? "cobraron este mes" : "deudores"}` : ""}
          </button>
        )}
      </div>

      {/* ── Tabla ──────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-[#4FAEB2]/10">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">Cargando…</div>
        ) : filtradas.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">No hay suscripciones para los filtros.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Cliente</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Plan</th>
                  <SortHeader label="Mensual" col="mensual" orden={orden} onSort={toggleOrden} align="right" />
                  <SortHeader label="Cobrado del mes" col="cobrado" orden={orden} onSort={toggleOrden} align="right" />
                  <SortHeader label="Adeudado total" col="adeudado" orden={orden} onSort={toggleOrden} align="right" />
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Estado</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Vendedor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtradas.map((r, i) => {
                  const pref = r.moneda === "USD" ? "USD " : "Gs. ";
                  return (
                    <tr key={`${r.cliente}-${r.plan}-${i}`} className="hover:bg-[#4FAEB2]/[0.04]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/10 text-[11px] font-bold text-[#3F8E91]">{iniciales(r.cliente)}</span>
                          <span className="font-semibold text-slate-800">{r.cliente}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.plan}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-600">{pref}{fmtGs(r.monto)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {r.cobrado_mes > 0 ? (
                          <span className="font-bold text-emerald-700">{pref}{fmtGs(r.cobrado_mes)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {r.adeudado_total > 0 ? (
                          <span className="font-bold text-rose-700">{pref}{fmtGs(r.adeudado_total)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><EstadoBadge estado={estadoDeuda(r)} /></td>
                      <td className="px-4 py-3 text-slate-600">{r.vendedor}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50/70">
                <tr>
                  <td className="px-4 py-3 text-xs font-bold text-slate-600" colSpan={2}>
                    {filtradas.length} suscripción{filtradas.length === 1 ? "" : "es"} activa{filtradas.length === 1 ? "" : "s"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-extrabold tabular-nums text-slate-900">
                    Gs. {fmtGs(filtradas.filter(gs).reduce((s, r) => s + r.monto, 0))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-extrabold tabular-nums text-emerald-700">
                    Gs. {fmtGs(filtradas.filter(gs).reduce((s, r) => s + r.cobrado_mes, 0))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-extrabold tabular-nums text-rose-700">
                    Gs. {fmtGs(filtradas.filter(gs).reduce((s, r) => s + r.adeudado_total, 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
