"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type EstadoMes = "pagado" | "pendiente" | "sin_facturar";
type Row = {
  cliente: string;
  plan: string;
  tipo_slug: string | null;
  tipo_label: string;
  monto: number;
  moneda: string;
  vendedor: string;
  estado_mes: EstadoMes;
};

function fmtGs(n: number) {
  return n.toLocaleString("es-PY");
}

function periodoLabel(ym: string) {
  const [y, m] = ym.split("-");
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const mi = parseInt(m ?? "", 10);
  return mi >= 1 && mi <= 12 ? `${meses[mi - 1]} ${y}` : ym;
}

function EstadoBadge({ estado }: { estado: EstadoMes }) {
  const cfg =
    estado === "pagado"
      ? { cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Pagado" }
      : estado === "pendiente"
        ? { cls: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500", label: "Pendiente" }
        : { cls: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400", label: "Sin facturar" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export default function ReporteSuscripcionesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [periodo, setPeriodo] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tipo, setTipo] = useState("");
  const [q, setQ] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"" | EstadoMes>("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchWithSupabaseSession("/api/reportes/suscripciones", { cache: "no-store" });
        const json = (await res.json()) as { success?: boolean; data?: { periodo: string; rows: Row[] }; error?: string };
        if (!res.ok || json.success !== true || !json.data) throw new Error(json.error ?? `Error ${res.status}`);
        if (!cancel) {
          setRows(json.data.rows);
          setPeriodo(json.data.periodo);
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

  // Lo que muestra la tabla: base + el filtro por estado (cards seleccionables).
  const filtradas = useMemo(
    () => (estadoFiltro ? baseFiltradas.filter((r) => r.estado_mes === estadoFiltro) : baseFiltradas),
    [baseFiltradas, estadoFiltro]
  );

  const totalGs = useMemo(
    () => filtradas.filter((r) => r.moneda === "GS").reduce((s, r) => s + r.monto, 0),
    [filtradas]
  );
  const nPagadas = baseFiltradas.filter((r) => r.estado_mes === "pagado").length;
  const nPendientes = baseFiltradas.filter((r) => r.estado_mes === "pendiente").length;
  const totalGsBase = baseFiltradas.filter((r) => r.moneda === "GS").reduce((s, r) => s + r.monto, 0);
  const toggleEstado = (e: EstadoMes) => setEstadoFiltro((prev) => (prev === e ? "" : e));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
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

      {/* KPIs (seleccionables: filtran la tabla por estado del mes). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setEstadoFiltro("")}
          aria-pressed={estadoFiltro === ""}
          className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
            estadoFiltro === "" ? "border-[#4FAEB2] ring-2 ring-[#4FAEB2]/40" : "border-slate-200 ring-1 ring-[#4FAEB2]/15"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Todas</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{baseFiltradas.length}</p>
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4FAEB2]">Mensual (Gs.)</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-[#3F8E91] tabular-nums">{fmtGs(totalGsBase)}</p>
        </div>
        <button
          type="button"
          onClick={() => toggleEstado("pagado")}
          aria-pressed={estadoFiltro === "pagado"}
          className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
            estadoFiltro === "pagado" ? "border-emerald-400 ring-2 ring-emerald-300" : "border-emerald-200"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-600">Pagadas del mes</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{nPagadas}</p>
        </button>
        <button
          type="button"
          onClick={() => toggleEstado("pendiente")}
          aria-pressed={estadoFiltro === "pendiente"}
          className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
            estadoFiltro === "pendiente" ? "border-amber-400 ring-2 ring-amber-300" : "border-amber-200"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-600">Pendientes del mes</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{nPendientes}</p>
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
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/70">
                <tr>
                  {["Cliente", "Plan", "Tipo", "Monto", "Estado del mes", "Vendedor"].map((h, i) => (
                    <th
                      key={h}
                      className={`whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${
                        i === 3 ? "text-right" : "text-left"
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
                    <td className="px-3 py-2.5 font-semibold text-slate-800">{r.cliente}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.plan}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2 py-0.5 text-[11px] font-semibold text-[#3F8E91]">
                        {r.tipo_label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-[#3F8E91]">
                      {r.moneda === "USD" ? "USD " : "Gs. "}
                      {fmtGs(r.monto)}
                    </td>
                    <td className="px-3 py-2.5">
                      <EstadoBadge estado={r.estado_mes} />
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
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm font-bold tabular-nums text-[#3F8E91]">
                    Gs. {fmtGs(totalGs)}
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
