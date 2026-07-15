"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getCuentasContablesOpciones, type CuentaContableOpcion } from "@/lib/compras/storage";
import CuentaCombobox from "@/components/contabilidad/CuentaCombobox";

interface Row {
  numero_asiento: string; fecha_contable: string; glosa: string | null; documento: string | null;
  cuenta_codigo: string; cuenta_denominacion: string; proveedor_nombre: string | null;
  debe: number; haber: number; estado: string;
}
interface Totales { totalDebe: number; totalHaber: number; diferencia: number }
const fmt = (v: number) => Math.round(Number(v) || 0).toLocaleString("es-PY");
const fom = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const tod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function LibroDiarioPage() {
  const [desde, setDesde] = useState(fom());
  const [hasta, setHasta] = useState(tod());
  const [cuentaId, setCuentaId] = useState("");
  const [origen, setOrigen] = useState("");
  const [estado, setEstado] = useState("");
  const [cuentas, setCuentas] = useState<CuentaContableOpcion[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [totales, setTotales] = useState<Totales | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (cuentaId) p.set("cuenta_id", cuentaId);
    if (origen) p.set("origen", origen);
    if (estado) p.set("estado", estado);
    return p.toString();
  }, [desde, hasta, cuentaId, origen, estado]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/api/reportes/libro-diario?${qs}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); setRows([]); setTotales(null); return; }
      setRows(j.data.rows as Row[]); setTotales(j.data.totales as Totales);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  }, [qs]);

  useEffect(() => { getCuentasContablesOpciones().then(setCuentas).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function exportar() {
    setError(null);
    try {
      const r = await apiFetch(`/api/reportes/libro-diario/export?${qs}`);
      if (!r.ok) { setError(`No autorizado o error al exportar (${r.status}).`); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = "libro-diario.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Error al exportar"); }
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500"><Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link> / <span className="font-semibold text-slate-700">Libro Diario</span></nav>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Libro Diario</h1>
          <p className="mt-1 text-sm text-slate-500">Asientos contables de Compras y Gastos y Servicios. En esta etapa contiene únicamente esos orígenes.</p>
        </div>
        <button onClick={exportar} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">Exportar Excel</button>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-semibold text-slate-500">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <label className="text-xs font-semibold text-slate-500">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <div className="text-xs font-semibold text-slate-500">Cuenta<div className="mt-1"><CuentaCombobox cuentas={cuentas} value={cuentaId || null} onChange={(id) => setCuentaId(id ?? "")} placeholder="Todas" /></div></div>
        <label className="text-xs font-semibold text-slate-500">Origen<select value={origen} onChange={(e) => setOrigen(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"><option value="">Todos</option><option value="gasto_servicio">Gasto y Servicio</option><option value="compra">Compra</option><option value="reversion">Reversión</option></select></label>
        <label className="text-xs font-semibold text-slate-500">Estado<select value={estado} onChange={(e) => setEstado(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"><option value="">Todos</option><option value="contabilizado">Contabilizado</option><option value="revertido">Revertido</option></select></label>
        <div className="flex items-end"><button onClick={load} className="w-full rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">Aplicar</button></div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="border-b bg-slate-50 uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left">Asiento</th><th className="px-2 py-2 text-left">Fecha</th>
              <th className="px-2 py-2 text-left">Origen</th><th className="px-2 py-2 text-left">Cuenta</th>
              <th className="px-2 py-2 text-left">Denominación</th><th className="px-2 py-2 text-left">Proveedor</th>
              <th className="px-2 py-2 text-right">Debe</th><th className="px-2 py-2 text-right">Haber</th>
              <th className="px-2 py-2 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className="px-2 py-8 text-center text-slate-400">Cargando…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={9} className="px-2 py-8 text-center text-slate-400">Sin asientos en el período/filtros.</td></tr>
            : rows.map((r, i) => (
              <tr key={i} className={`border-b last:border-0 hover:bg-slate-50/60 ${r.estado === "revertido" ? "opacity-60" : ""}`}>
                <td className="px-2 py-1.5 font-mono">{r.numero_asiento}</td>
                <td className="px-2 py-1.5">{(r.fecha_contable ?? "").slice(0, 10)}</td>
                <td className="px-2 py-1.5">{r.documento ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono">{r.cuenta_codigo}</td>
                <td className="px-2 py-1.5">{r.cuenta_denominacion}</td>
                <td className="px-2 py-1.5">{r.proveedor_nombre ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.debe ? fmt(r.debe) : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.haber ? fmt(r.haber) : ""}</td>
                <td className="px-2 py-1.5 text-center text-slate-500">{r.estado}</td>
              </tr>
            ))}
          </tbody>
          {totales && rows.length > 0 && (
            <tfoot className="border-t bg-slate-50 font-semibold text-slate-800">
              <tr>
                <td colSpan={6} className="px-2 py-2 text-right">Totales</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totales.totalDebe)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totales.totalHaber)}</td>
                <td className="px-2 py-2 text-center">Dif: {fmt(totales.diferencia)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
