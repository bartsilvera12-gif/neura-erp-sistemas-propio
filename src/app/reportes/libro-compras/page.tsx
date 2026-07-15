"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";

interface Row {
  origen_tipo: "compra" | "gasto";
  origen: string;
  fecha: string | null;
  proveedor: string | null;
  ruc: string | null;
  tipo_comprobante: string | null;
  timbrado: string | null;
  numero: string | null;
  condicion: string | null;
  exento: number;
  gravado5: number;
  iva5: number;
  gravado10: number;
  iva10: number;
  total: number;
  estado: string;
}
interface Totals { exento: number; gravado5: number; iva5: number; gravado10: number; iva10: number; total: number; cantidad: number }

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function LibroComprasPage() {
  const [desde, setDesde] = useState(firstOfMonth());
  const [hasta, setHasta] = useState(today());
  const [proveedorId, setProveedorId] = useState("");
  const [origen, setOrigen] = useState("");
  const [condicion, setCondicion] = useState("");
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
    if (origen) p.set("origen", origen);
    if (condicion) p.set("condicion", condicion);
    return p.toString();
  }, [desde, hasta, proveedorId, origen, condicion]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/reportes/libro-compras?${qs}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        setRows([]); setTotals(null);
        return;
      }
      setRows(j.data.rows as Row[]);
      setTotals(j.data.totals as Totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    getProveedores().then(setProveedores).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function exportar() {
    setError(null);
    try {
      const r = await apiFetch(`/api/reportes/libro-compras/export?${qs}`);
      if (!r.ok) {
        setError(`No autorizado o error al exportar (${r.status}).`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "libro-compras.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al exportar");
    }
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500">
            <Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link> / <span className="font-semibold text-slate-700">Libro de Compras</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Libro de Compras</h1>
          <p className="mt-1 text-sm text-slate-500">Compras válidas + Gastos y Servicios confirmados con datos fiscales. No incluye borradores, anulados ni históricos incompletos.</p>
        </div>
        <button onClick={exportar} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">
          Exportar Excel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-semibold text-slate-500">Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-500">Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-500">Proveedor
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {proveedores.map((p) => <option key={p.id} value={String(p.id)}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-500">Origen
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            <option value="compra">Compra</option>
            <option value="gasto">Gasto o Servicio</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-500">Condición
          <select value={condicion} onChange={(e) => setCondicion(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todas</option>
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
          </select>
        </label>
        <div className="flex items-end">
          <button onClick={load} className="w-full rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">Aplicar</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="border-b bg-slate-50 uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left">Fecha</th>
              <th className="px-2 py-2 text-left">Origen</th>
              <th className="px-2 py-2 text-left">Proveedor</th>
              <th className="px-2 py-2 text-left">RUC</th>
              <th className="px-2 py-2 text-left">Comprobante</th>
              <th className="px-2 py-2 text-left">Timbrado</th>
              <th className="px-2 py-2 text-left">Número</th>
              <th className="px-2 py-2 text-left">Cond.</th>
              <th className="px-2 py-2 text-right">Exento</th>
              <th className="px-2 py-2 text-right">Grav. 5%</th>
              <th className="px-2 py-2 text-right">IVA 5%</th>
              <th className="px-2 py-2 text-right">Grav. 10%</th>
              <th className="px-2 py-2 text-right">IVA 10%</th>
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={15} className="px-2 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={15} className="px-2 py-8 text-center text-slate-400">Sin documentos en el período/filtros.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-slate-50/60">
                <td className="px-2 py-1.5">{(r.fecha ?? "").slice(0, 10)}</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${r.origen_tipo === "compra" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>{r.origen}</span>
                </td>
                <td className="px-2 py-1.5">{r.proveedor ?? "—"}</td>
                <td className="px-2 py-1.5">{r.ruc ?? "—"}</td>
                <td className="px-2 py-1.5">{r.tipo_comprobante ?? "—"}</td>
                <td className="px-2 py-1.5">{r.timbrado ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono">{r.numero ?? "—"}</td>
                <td className="px-2 py-1.5">{r.condicion ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.exento)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.gravado5)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.iva5)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.gravado10)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.iva10)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(r.total)}</td>
                <td className="px-2 py-1.5 text-center text-slate-500">{r.estado}</td>
              </tr>
            ))}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot className="border-t bg-slate-50 font-semibold text-slate-800">
              <tr>
                <td className="px-2 py-2" colSpan={8}>TOTALES ({totals.cantidad} doc.)</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.exento)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.gravado5)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.iva5)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.gravado10)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.iva10)}</td>
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
