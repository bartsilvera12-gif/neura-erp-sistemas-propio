"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type EstadoMes = "pagado" | "pendiente" | "sin_facturar";
type EstadoCobro = "cobrada" | "parcial" | "sin_cobrar";
type Row = {
  cliente: string;
  plan: string;
  tipo_slug: string | null;
  tipo_label: string;
  monto: number;
  cobrado_mes: number;
  moneda: string;
  vendedor: string;
  estado_mes: EstadoMes;
};

/** Estado de cobro del mes derivado de la plata cobrada vs la cuota mensual. */
function estadoCobro(r: Row): EstadoCobro {
  if (r.cobrado_mes <= 0) return "sin_cobrar";
  if (r.cobrado_mes >= r.monto) return "cobrada";
  return "parcial";
}

function fmtGs(n: number) {
  return n.toLocaleString("es-PY");
}

function periodoLabel(ym: string) {
  const [y, m] = ym.split("-");
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const mi = parseInt(m ?? "", 10);
  return mi >= 1 && mi <= 12 ? `${meses[mi - 1]} ${y}` : ym;
}

function EstadoBadge({ estado }: { estado: EstadoCobro }) {
  const cfg =
    estado === "cobrada"
      ? { cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Cobrada" }
      : estado === "parcial"
        ? { cls: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500", label: "Parcial" }
        : { cls: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400", label: "Sin cobrar" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/** Redondea a un tope "lindo" para la escala del medidor. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

/** Semicírculo comparativo: dos agujas (mes anterior gris, mes actual teal) + variación. */
function GaugeComparacion({ anterior, actual }: { anterior: number; actual: number }) {
  const cx = 110;
  const cy = 106;
  const R = 92;
  const maxScale = niceMax(Math.max(anterior, actual, 1) * 1.1);
  const punto = (v: number, r: number) => {
    const f = Math.max(0, Math.min(1, v / maxScale));
    const a = Math.PI * (1 - f); // izquierda (PI) = 0, derecha (0) = máx
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };
  const arcEnd = punto(actual, R);
  const ant = punto(anterior, R * 0.84);
  const act = punto(actual, R * 0.84);
  const delta = anterior > 0 ? ((actual - anterior) / anterior) * 100 : actual > 0 ? 100 : 0;
  const up = actual >= anterior;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 124" className="w-full max-w-[260px]" role="img" aria-label="Comparativo mes anterior vs mes actual">
        <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="#e2e8f0" strokeWidth="13" strokeLinecap="round" />
        <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${arcEnd.x} ${arcEnd.y}`} fill="none" stroke="#4FAEB2" strokeWidth="13" strokeLinecap="round" />
        {/* Aguja mes anterior */}
        <line x1={cx} y1={cy} x2={ant.x} y2={ant.y} stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
        {/* Aguja mes actual */}
        <line x1={cx} y1={cy} x2={act.x} y2={act.y} stroke="#3F8E91" strokeWidth="4" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="6" fill="#3F8E91" />
        <text x={cx - R} y={cy + 15} fontSize="9" textAnchor="middle" fill="#94a3b8">0</text>
        <text x={cx + R} y={cy + 15} fontSize="9" textAnchor="middle" fill="#94a3b8">{fmtGs(maxScale)}</text>
      </svg>
      <p className={`-mt-1 text-center text-sm font-bold ${up ? "text-emerald-600" : "text-red-600"}`}>
        {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs mes anterior
      </p>
    </div>
  );
}

/** Panel con título + semicírculo comparativo + los dos montos etiquetados. */
function GaugePanel({
  titulo,
  anterior,
  actual,
  labelAnterior,
  labelActual,
}: {
  titulo: string;
  anterior: number;
  actual: number;
  labelAnterior: string;
  labelActual: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{titulo}</p>
      <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row sm:justify-around">
        <GaugeComparacion anterior={anterior} actual={actual} />
        <div className="grid grid-cols-2 gap-6 text-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{labelAnterior}</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-lg font-bold tabular-nums text-slate-500">
              <span aria-hidden className="h-2 w-2 rounded-full bg-slate-400" /> Gs. {fmtGs(anterior)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#4FAEB2]">{labelActual}</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-lg font-bold tabular-nums text-[#3F8E91]">
              <span aria-hidden className="h-2 w-2 rounded-full bg-[#3F8E91]" /> Gs. {fmtGs(actual)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReporteSuscripcionesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [periodo, setPeriodo] = useState("");
  const [periodoAnterior, setPeriodoAnterior] = useState("");
  const [totalMes, setTotalMes] = useState(0);
  const [totalMesAnterior, setTotalMesAnterior] = useState(0);
  const [cobradoMes, setCobradoMes] = useState(0);
  const [cobradoMesAnterior, setCobradoMesAnterior] = useState(0);
  const [diaCorte, setDiaCorte] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tipo, setTipo] = useState("");
  const [q, setQ] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"" | "cobrado" | "por_cobrar">("");

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
            total_mes?: number;
            total_mes_anterior?: number;
            cobrado_mes?: number;
            cobrado_mes_anterior?: number;
            rows: Row[];
          };
          error?: string;
        };
        if (!res.ok || json.success !== true || !json.data) throw new Error(json.error ?? `Error ${res.status}`);
        if (!cancel) {
          setRows(json.data.rows);
          setPeriodo(json.data.periodo);
          setPeriodoAnterior(json.data.periodo_anterior ?? "");
          setDiaCorte(Number(json.data.dia_corte) || 0);
          setTotalMes(Number(json.data.total_mes) || 0);
          setTotalMesAnterior(Number(json.data.total_mes_anterior) || 0);
          setCobradoMes(Number(json.data.cobrado_mes) || 0);
          setCobradoMesAnterior(Number(json.data.cobrado_mes_anterior) || 0);
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

  // Filtro base (tipo + búsqueda): alimenta los KPIs, que se mantienen estables al clickear un card.
  const baseFiltradas = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tipo && r.tipo_slug !== tipo) return false;
      if (needle) {
        const hay = `${r.cliente} ${r.plan} ${r.vendedor} ${r.tipo_label}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, tipo, q]);

  // Lo que muestra la tabla: base + el filtro por estado de cobro (cards seleccionables).
  const filtradas = useMemo(() => {
    if (estadoFiltro === "cobrado") return baseFiltradas.filter((r) => r.cobrado_mes > 0);
    if (estadoFiltro === "por_cobrar") return baseFiltradas.filter((r) => r.cobrado_mes < r.monto);
    return baseFiltradas;
  }, [baseFiltradas, estadoFiltro]);

  // Sumas de la tabla (lo filtrado) — el pie muestra estas.
  const sumMontoFiltradas = useMemo(
    () => filtradas.filter((r) => r.moneda === "GS").reduce((s, r) => s + r.monto, 0),
    [filtradas]
  );
  const sumCobradoFiltradas = useMemo(
    () => filtradas.filter((r) => r.moneda === "GS").reduce((s, r) => s + r.cobrado_mes, 0),
    [filtradas]
  );

  // Sumas base (respetan tipo+búsqueda, NO el card seleccionado) → alimentan los KPIs.
  const gs = (r: Row) => r.moneda === "GS";
  const mensualObjetivoBase = baseFiltradas.filter(gs).reduce((s, r) => s + r.monto, 0);
  const cobradoBase = baseFiltradas.filter(gs).reduce((s, r) => s + r.cobrado_mes, 0);
  const porCobrarBase = baseFiltradas.filter(gs).reduce((s, r) => s + Math.max(r.monto - r.cobrado_mes, 0), 0);

  // Diferencia entre la caja total de cuotas (semicírculo) y lo atribuido a las suscripciones
  // activas listadas: cuotas cobradas de suscripciones fuera de la lista (bajas / sin sub activa).
  const cobradoEnLista = rows.filter(gs).reduce((s, r) => s + r.cobrado_mes, 0);
  const cobradoFueraLista = Math.max(cobradoMes - cobradoEnLista, 0);

  const toggleEstado = (e: "cobrado" | "por_cobrar") => setEstadoFiltro((prev) => (prev === e ? "" : e));

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Link href="/reportes" className="hover:text-[#4FAEB2]">
              Reportes
            </Link>
            <span>/</span>
            <span className="font-medium text-slate-700">Suscripciones</span>
          </div>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">Suscripciones</h1>
          <p className="text-xs text-slate-500">
            Suscripciones activas por tipo, con monto mensual y estado de cobro del período{" "}
            <span className="font-semibold text-slate-700">{periodo ? periodoLabel(periodo) : "actual"}</span>.
          </p>
        </div>
      </div>

      {/* Dos comparativas (semicírculo con 2 agujas), solo suscripciones —no ventas nuevas—:
          1) Emitido/facturado del mes vs mes anterior.
          2) Cobrado a la fecha del día (mismo día del mes) vs mes anterior. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GaugePanel
          titulo="Emitido (facturado) · mes anterior vs este mes"
          anterior={totalMesAnterior}
          actual={totalMes}
          labelAnterior={periodoAnterior ? periodoLabel(periodoAnterior) : "Mes anterior"}
          labelActual={periodo ? periodoLabel(periodo) : "Este mes"}
        />
        <GaugePanel
          titulo={`Cobrado de suscripciones · al día ${diaCorte} de cada mes`}
          anterior={cobradoMesAnterior}
          actual={cobradoMes}
          labelAnterior={periodoAnterior ? periodoLabel(periodoAnterior) : "Mes anterior"}
          labelActual={periodo ? periodoLabel(periodo) : "Este mes"}
        />
      </div>

      {cobradoFueraLista > 0 && (
        <p className="-mt-1 text-[11px] text-slate-400">
          El total cobrado del semicírculo incluye{" "}
          <span className="font-semibold text-slate-500">Gs. {fmtGs(cobradoFueraLista)}</span> de cuotas de
          suscripciones que no figuran en la lista de activas (clientes dados de baja o sin suscripción activa).
          La tabla suma solo las activas.
        </p>
      )}

      {/* KPIs — todo en Gs. de CUOTAS: coinciden con el semicírculo y con el pie de la tabla.
          "Cobrado del mes" y "Por cobrar" son seleccionables y filtran la tabla. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setEstadoFiltro("")}
          aria-pressed={estadoFiltro === ""}
          className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
            estadoFiltro === "" ? "border-[#4FAEB2] ring-2 ring-[#4FAEB2]/40" : "border-slate-200 ring-1 ring-[#4FAEB2]/15"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Suscripciones</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{baseFiltradas.length}</p>
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Mensual objetivo (Gs.)</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-700 tabular-nums">{fmtGs(mensualObjetivoBase)}</p>
        </div>
        <button
          type="button"
          onClick={() => toggleEstado("cobrado")}
          aria-pressed={estadoFiltro === "cobrado"}
          className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
            estadoFiltro === "cobrado" ? "border-emerald-400 ring-2 ring-emerald-300" : "border-emerald-200"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-600">Cobrado del mes (Gs.)</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-emerald-700 tabular-nums">{fmtGs(cobradoBase)}</p>
        </button>
        <button
          type="button"
          onClick={() => toggleEstado("por_cobrar")}
          aria-pressed={estadoFiltro === "por_cobrar"}
          className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
            estadoFiltro === "por_cobrar" ? "border-amber-400 ring-2 ring-amber-300" : "border-amber-200"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-600">Por cobrar (Gs.)</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-amber-700 tabular-nums">{fmtGs(porCobrarBase)}</p>
        </button>
      </div>

      {/* Filtros */}
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
            <option key={slug} value={slug}>
              {label}
            </option>
          ))}
        </select>
        {(q || tipo || estadoFiltro) && (
          <button
            onClick={() => {
              setQ("");
              setTipo("");
              setEstadoFiltro("");
            }}
            className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-[#4FAEB2]/15">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400">Cargando…</div>
        ) : err ? (
          <div className="py-16 text-center text-sm text-red-600">{err}</div>
        ) : filtradas.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">No hay suscripciones para los filtros.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70">
                <tr>
                  {["Cliente", "Plan", "Tipo", "Mensual", "Cobrado del mes", "Estado", "Vendedor"].map((h, i) => (
                    <th
                      key={h}
                      className={`whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${
                        i === 3 || i === 4 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtradas.map((r, i) => (
                  <tr key={`${r.cliente}-${r.plan}-${i}`} className="hover:bg-[#4FAEB2]/[0.04]">
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-800">{r.cliente}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{r.plan}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2 py-0.5 text-[11px] font-semibold text-[#3F8E91]">
                        {r.tipo_label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-600">
                      {r.moneda === "USD" ? "USD " : "Gs. "}
                      {fmtGs(r.monto)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-[#3F8E91]">
                      {r.cobrado_mes > 0 ? `${r.moneda === "USD" ? "USD " : "Gs. "}${fmtGs(r.cobrado_mes)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <EstadoBadge estado={estadoCobro(r)} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{r.vendedor}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50/70">
                <tr>
                  <td className="px-3 py-2.5 text-xs font-semibold text-slate-600" colSpan={3}>
                    {filtradas.length} suscripción{filtradas.length === 1 ? "" : "es"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-bold tabular-nums text-slate-600">
                    Gs. {fmtGs(sumMontoFiltradas)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-bold tabular-nums text-[#3F8E91]">
                    Gs. {fmtGs(sumCobradoFiltradas)}
                  </td>
                  <td className="px-3 py-2.5" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
