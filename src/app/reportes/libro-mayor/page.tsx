"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getCuentasContablesOpciones, type CuentaContableOpcion } from "@/lib/compras/storage";
import CuentaCombobox from "@/components/contabilidad/CuentaCombobox";

interface Mov { fecha_contable: string; numero_asiento: string; origen_tipo: string; descripcion: string | null; proveedor_nombre: string | null; debe: number; haber: number; saldo_acumulado: number }
interface Cuenta { cuenta_codigo: string; denominacion: string; naturaleza: string; saldo_inicial: number; movimientos: Mov[]; total_debe: number; total_haber: number; saldo_final: number }
const fmt = (v: number) => Math.round(Number(v) || 0).toLocaleString("es-PY");
const doc = (o: string) => (o === "compra" ? "Compra" : o === "gasto_servicio" ? "Gasto y Servicio" : o === "reversion" ? "Reversión" : o);
const fom = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const tod = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function LibroMayorPage() {
  const [desde, setDesde] = useState(fom());
  const [hasta, setHasta] = useState(tod());
  const [cuentaId, setCuentaId] = useState("");
  const [naturaleza, setNaturaleza] = useState("");
  const [origen, setOrigen] = useState("");
  const [cuentas, setCuentas] = useState<CuentaContableOpcion[]>([]);
  const [data, setData] = useState<Cuenta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (cuentaId) p.set("cuenta_id", cuentaId);
    if (naturaleza) p.set("naturaleza", naturaleza);
    if (origen) p.set("origen", origen);
    return p.toString();
  }, [desde, hasta, cuentaId, naturaleza, origen]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/api/reportes/libro-mayor?${qs}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); setData([]); return; }
      setData(j.data.cuentas as Cuenta[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  }, [qs]);

  useEffect(() => { getCuentasContablesOpciones().then(setCuentas).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function exportar() {
    setError(null);
    try {
      const r = await apiFetch(`/api/reportes/libro-mayor/export?${qs}`);
      if (!r.ok) { setError(`No autorizado o error al exportar (${r.status}).`); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = "libro-mayor.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Error al exportar"); }
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500"><Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link> / <span className="font-semibold text-slate-700">Libro Mayor</span></nav>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Libro Mayor</h1>
          <p className="mt-1 text-sm text-slate-500">Movimientos y saldos por cuenta. En esta etapa contiene únicamente asientos de Compras y Gastos y Servicios.</p>
        </div>
        <button onClick={exportar} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">Exportar Excel</button>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-semibold text-slate-500">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <label className="text-xs font-semibold text-slate-500">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <div className="text-xs font-semibold text-slate-500">Cuenta<div className="mt-1"><CuentaCombobox cuentas={cuentas} value={cuentaId || null} onChange={(id) => setCuentaId(id ?? "")} placeholder="Todas" /></div></div>
        <label className="text-xs font-semibold text-slate-500">Naturaleza<select value={naturaleza} onChange={(e) => setNaturaleza(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"><option value="">Todas</option><option value="D">Deudora</option><option value="A">Acreedora</option></select></label>
        <label className="text-xs font-semibold text-slate-500">Origen<select value={origen} onChange={(e) => setOrigen(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"><option value="">Todos</option><option value="gasto_servicio">Gasto y Servicio</option><option value="compra">Compra</option><option value="reversion">Reversión</option></select></label>
        <div className="flex items-end"><button onClick={load} className="w-full rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">Aplicar</button></div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">Cargando…</div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">Sin movimientos en el período/filtros.</div>
      ) : data.map((c) => (
        <div key={c.cuenta_codigo} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-800"><span className="font-mono">{c.cuenta_codigo}</span> — {c.denominacion} <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">{c.naturaleza === "D" ? "Deudora" : "Acreedora"}</span></span>
            <span className="text-xs text-slate-500">Saldo inicial: <b className="tabular-nums text-slate-700">{fmt(c.saldo_inicial)}</b> · Saldo final: <b className="tabular-nums text-slate-900">{fmt(c.saldo_final)}</b></span>
          </div>
          <table className="w-full min-w-[820px] text-xs">
            <thead className="border-b bg-white uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left">Fecha</th><th className="px-2 py-1.5 text-left">Asiento</th>
                <th className="px-2 py-1.5 text-left">Documento</th><th className="px-2 py-1.5 text-left">Descripción</th>
                <th className="px-2 py-1.5 text-left">Proveedor</th>
                <th className="px-2 py-1.5 text-right">Debe</th><th className="px-2 py-1.5 text-right">Haber</th><th className="px-2 py-1.5 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-slate-50/50 text-slate-500"><td colSpan={7} className="px-2 py-1.5 text-right italic">Saldo inicial</td><td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(c.saldo_inicial)}</td></tr>
              {c.movimientos.map((m, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-2 py-1.5">{(m.fecha_contable ?? "").slice(0, 10)}</td>
                  <td className="px-2 py-1.5 font-mono">{m.numero_asiento}</td>
                  <td className="px-2 py-1.5">{doc(m.origen_tipo)}</td>
                  <td className="px-2 py-1.5">{m.descripcion ?? "—"}</td>
                  <td className="px-2 py-1.5">{m.proveedor_nombre ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.debe ? fmt(m.debe) : ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.haber ? fmt(m.haber) : ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(m.saldo_acumulado)}</td>
                </tr>
              ))}
              <tr className="border-t bg-slate-50 font-semibold text-slate-800">
                <td colSpan={5} className="px-2 py-1.5 text-right">Totales / Saldo final</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.total_debe)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.total_haber)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.saldo_final)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
