"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";
import { FechaSelect } from "@/components/ui/FechaSelect";

interface Row {
  compra_id: string; numero_control: string; fecha: string | null; fecha_vencimiento: string | null;
  proveedor: string | null; ruc: string | null; tipo_comprobante: string | null; numero_comprobante: string | null;
  timbrado: string | null; plazo_dias: number | null; cuotas: number;
  total: number; monto_cuota: number; vencida: boolean; dias_para_vencer: number | null;
}
interface Totals { cantidad: number; total: number; vencido: number; por_vencer: number }

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function CuentasPorPagarPage() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState(today());
  const [proveedorId, setProveedorId] = useState("");
  const [estado, setEstado] = useState("");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (proveedorId) p.set("proveedor_id", proveedorId);
    if (estado) p.set("estado", estado);
    return p.toString();
  }, [desde, hasta, proveedorId, estado]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/api/reportes/cuentas-por-pagar?${qs}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); setRows([]); setTotals(null); return; }
      setRows(j.data.rows as Row[]);
      setTotals(j.data.totals as Totals);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  }, [qs]);

  useEffect(() => { getProveedores().then(setProveedores).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function exportar() {
    setError(null);
    try {
      const r = await apiFetch(`/api/reportes/cuentas-por-pagar/export?${qs}`);
      if (!r.ok) { setError(`No autorizado o error al exportar (${r.status}).`); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = "cuentas-por-pagar.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Error al exportar"); }
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500">
            <Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link> / <span className="font-semibold text-slate-700">Cuentas por Pagar</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Cuentas por Pagar</h1>
          <p className="mt-1 text-sm text-slate-500">Deuda con proveedores por compras a crédito. Vencimiento = fecha + plazo. Excluye compras anuladas.</p>
        </div>
        <button onClick={exportar} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">
          Exportar Excel
        </button>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-400">Documentos</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{totals.cantidad}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-400">Total adeudado</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">₲ {fmt(totals.total)}</p>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-xs text-red-500">Vencido</p>
            <p className="text-lg font-bold tabular-nums text-red-700">₲ {fmt(totals.vencido)}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <p className="text-xs text-emerald-600">Por vencer</p>
            <p className="text-lg font-bold tabular-nums text-emerald-700">₲ {fmt(totals.por_vencer)}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
        <label className="text-xs font-semibold text-slate-500">Desde
          <FechaSelect value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <label className="text-xs font-semibold text-slate-500">Hasta
          <FechaSelect value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <label className="text-xs font-semibold text-slate-500">Proveedor
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {proveedores.map((p) => <option key={p.id} value={String(p.id)}>{p.nombre}</option>)}
          </select></label>
        <label className="text-xs font-semibold text-slate-500">Estado
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todas</option>
            <option value="vencidas">Vencidas</option>
            <option value="por_vencer">Por vencer</option>
          </select></label>
        <div className="flex items-end">
          <button onClick={load} className="w-full rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">Aplicar</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1000px] text-xs">
          <thead className="border-b bg-slate-50 uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left">N° Control</th>
              <th className="px-2 py-2 text-left">Fecha</th>
              <th className="px-2 py-2 text-left">Vencimiento</th>
              <th className="px-2 py-2 text-left">Proveedor</th>
              <th className="px-2 py-2 text-left">Comprobante</th>
              <th className="px-2 py-2 text-right">Plazo</th>
              <th className="px-2 py-2 text-right">Cuotas</th>
              <th className="px-2 py-2 text-right">Monto/cuota</th>
              <th className="px-2 py-2 text-right">Total adeudado</th>
              <th className="px-2 py-2 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-2 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-2 py-8 text-center text-slate-400">Sin deudas a crédito en el período/filtros.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.compra_id} className="border-b last:border-0 hover:bg-slate-50/60">
                <td className="px-2 py-1.5 font-mono">{r.numero_control}</td>
                <td className="px-2 py-1.5">{(r.fecha ?? "").slice(0, 10)}</td>
                <td className="px-2 py-1.5">{(r.fecha_vencimiento ?? "").slice(0, 10)}</td>
                <td className="px-2 py-1.5">{r.proveedor ?? "—"}</td>
                <td className="px-2 py-1.5">{[r.tipo_comprobante, r.numero_comprobante].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.plazo_dias ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.cuotas}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.monto_cuota)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(r.total)}</td>
                <td className="px-2 py-1.5 text-center">
                  {r.vencida ? (
                    <span className="rounded px-1.5 py-0.5 font-medium bg-red-50 text-red-700">Vencida</span>
                  ) : (
                    <span className="rounded px-1.5 py-0.5 font-medium bg-emerald-50 text-emerald-700">
                      {r.dias_para_vencer != null ? `${r.dias_para_vencer} d` : "Por vencer"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot className="border-t bg-slate-50 font-semibold text-slate-800">
              <tr>
                <td className="px-2 py-2" colSpan={8}>TOTAL ADEUDADO ({totals.cantidad} doc.)</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
