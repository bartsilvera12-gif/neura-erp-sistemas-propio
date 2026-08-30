"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { FechaSelect } from "@/components/ui/FechaSelect";

interface Row {
  origen_tipo: "factura" | "nota_credito";
  origen: "manual" | "suscripcion";
  fecha: string | null;
  cliente: string | null;
  ruc: string | null;
  tipo_comprobante: string;
  timbrado: string | null;
  numero: string | null;
  condicion: string | null;
  exento: number; gravado5: number; iva5: number; gravado10: number; iva10: number;
  total: number;
  estado: string;
}
interface Totals {
  exento: number; gravado5: number; iva5: number; gravado10: number; iva10: number;
  total: number; cantidad: number; facturas_total: number; nc_total: number; neto: number;
}
interface Cliente { id: string; nombre: string }

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-PY");
const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function LibroVentasPage() {
  const [desde, setDesde] = useState(firstOfMonth());
  const [hasta, setHasta] = useState(today());
  const [clienteId, setClienteId] = useState("");
  const [condicion, setCondicion] = useState("");
  const [origen, setOrigen] = useState("");
  const [tipo, setTipo] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (clienteId) p.set("cliente_id", clienteId);
    if (condicion) p.set("condicion", condicion);
    if (origen) p.set("origen", origen);
    if (tipo) p.set("tipo", tipo);
    return p.toString();
  }, [desde, hasta, clienteId, condicion, origen, tipo]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/api/reportes/libro-ventas?${qs}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); setRows([]); setTotals(null); return; }
      setRows(j.data.rows as Row[]);
      setTotals(j.data.totals as Totals);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  }, [qs]);

  useEffect(() => {
    apiFetch("/api/clientes").then(async (r) => {
      const j = await r.json().catch(() => ({}));
      const list = (j?.data?.clientes ?? j?.data ?? []) as { id: string; nombre?: string; razon_social?: string; empresa?: string }[];
      setClientes(list.map((c) => ({ id: c.id, nombre: c.razon_social || c.nombre || c.empresa || "—" })));
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function exportar() {
    setError(null);
    try {
      const r = await apiFetch(`/api/reportes/libro-ventas/export?${qs}`);
      if (!r.ok) { setError(`No autorizado o error al exportar (${r.status}).`); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = "libro-ventas.xlsx";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Error al exportar"); }
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500">
            <Link href="/reportes" className="hover:text-[#4FAEB2]">Reportes</Link> / <span className="font-semibold text-slate-700">Libro de Ventas</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Libro de Ventas</h1>
          <p className="mt-1 text-sm text-slate-500">Solo comprobantes fiscales válidos (facturas con DTE aprobado) por fecha del comprobante. Las notas de crédito figuran como movimientos negativos. No incluye ventas POS ni documentos no fiscales.</p>
        </div>
        <button onClick={exportar} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">
          Exportar Excel
        </button>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"><p className="text-xs text-slate-400">Comprobantes</p><p className="text-lg font-bold tabular-nums text-slate-800">{totals.cantidad}</p></div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"><p className="text-xs text-slate-400">Facturas</p><p className="text-lg font-bold tabular-nums text-slate-800">₲ {fmt(totals.facturas_total)}</p></div>
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3"><p className="text-xs text-red-500">Notas de crédito</p><p className="text-lg font-bold tabular-nums text-red-700">₲ {fmt(totals.nc_total)}</p></div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3"><p className="text-xs text-emerald-600">Neto</p><p className="text-lg font-bold tabular-nums text-emerald-700">₲ {fmt(totals.neto)}</p></div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-7">
        <label className="text-xs font-semibold text-slate-500">Desde
          <FechaSelect value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <label className="text-xs font-semibold text-slate-500">Hasta
          <FechaSelect value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" /></label>
        <label className="text-xs font-semibold text-slate-500">Cliente
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select></label>
        <label className="text-xs font-semibold text-slate-500">Condición
          <select value={condicion} onChange={(e) => setCondicion(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todas</option><option value="contado">Contado</option><option value="credito">Crédito</option>
          </select></label>
        <label className="text-xs font-semibold text-slate-500">Origen
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todos</option><option value="manual">Manual</option><option value="suscripcion">Suscripción</option>
          </select></label>
        <label className="text-xs font-semibold text-slate-500">Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Todos</option><option value="factura">Factura</option><option value="nota_credito">Nota de Crédito</option>
          </select></label>
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
              <th className="px-2 py-2 text-left">Comprobante</th>
              <th className="px-2 py-2 text-left">Cliente</th>
              <th className="px-2 py-2 text-left">RUC</th>
              <th className="px-2 py-2 text-left">Timbrado</th>
              <th className="px-2 py-2 text-left">Número</th>
              <th className="px-2 py-2 text-left">Cond.</th>
              <th className="px-2 py-2 text-right">Exento</th>
              <th className="px-2 py-2 text-right">Grav. 5%</th>
              <th className="px-2 py-2 text-right">IVA 5%</th>
              <th className="px-2 py-2 text-right">Grav. 10%</th>
              <th className="px-2 py-2 text-right">IVA 10%</th>
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="px-2 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={13} className="px-2 py-8 text-center text-slate-400">Sin comprobantes fiscales en el período/filtros.</td></tr>
            ) : rows.map((r, i) => {
              const esNC = r.origen_tipo === "nota_credito";
              return (
                <tr key={i} className={`border-b last:border-0 hover:bg-slate-50/60 ${esNC ? "bg-red-50/40" : ""}`}>
                  <td className="px-2 py-1.5">{(r.fecha ?? "").slice(0, 10)}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${esNC ? "bg-red-100 text-red-700" : "bg-sky-50 text-sky-700"}`}>{r.tipo_comprobante}</span>
                    {r.origen === "suscripcion" && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">susc.</span>}
                  </td>
                  <td className="px-2 py-1.5">{r.cliente ?? "—"}</td>
                  <td className="px-2 py-1.5">{r.ruc ?? "—"}</td>
                  <td className="px-2 py-1.5">{r.timbrado ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono">{r.numero ?? "—"}</td>
                  <td className="px-2 py-1.5">{r.condicion ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.exento)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.gravado5)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.iva5)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.gravado10)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.iva10)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${esNC ? "text-red-700" : ""}`}>{fmt(r.total)}</td>
                </tr>
              );
            })}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot className="border-t bg-slate-50 font-semibold text-slate-800">
              <tr>
                <td className="px-2 py-2" colSpan={7}>TOTALES ({totals.cantidad} comp.)</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.exento)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.gravado5)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.iva5)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.gravado10)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.iva10)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
