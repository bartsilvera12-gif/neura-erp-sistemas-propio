"use client";

/**
 * /compras/solicitudes — bandeja de solicitudes de compra (comercial).
 *
 * Lista las solicitudes (órdenes en estado 'solicitada') y el acceso a cargar una
 * nueva. La confirmación (aprobar/rechazar) y el pago llegan en las próximas fases.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, Loader2, Plus } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { gs } from "@/erp2/modules/compras/partes";

const TEAL = clienteConfig.color;

type Solicitud = {
  id: string;
  numero_oc: string;
  fecha: string;
  proveedor_nombre: string | null;
  estado: string;
  total: number;
  cantidad_items: number;
  unidades: number;
  usuario_nombre: string | null;
};

const ESTADO: Record<string, { label: string; cls: string }> = {
  solicitada: { label: "Solicitada", cls: "bg-amber-50 text-amber-700" },
  pendiente: { label: "Aprobada", cls: "bg-blue-50 text-blue-700" },
  rechazada: { label: "Rechazada", cls: "bg-rose-50 text-rose-700" },
  cancelada: { label: "Cancelada", cls: "bg-slate-100 text-slate-600" },
};

export default function SolicitudesPage() {
  const [rows, setRows] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const d = await apiFetch<{ rows: Solicitud[] }>("/api/v2/compras/solicitudes");
        if (vivo) setRows(d.rows ?? []);
      } catch (e) {
        if (vivo) setError((e as Error).message);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Compras</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Solicitudes de compra</h1>
          <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">Pedidos de productos a comprar. Quedan a confirmación antes de recibirse.</p>
        </div>
        <Link href="/compras/solicitudes/nueva" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>
          <Plus className="h-4 w-4" /> Nueva solicitud
        </Link>
      </header>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Nº</th>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Proveedor</th>
              <th className="px-3 py-2.5 text-left">Solicitó</th>
              <th className="px-3 py-2.5 text-right">Ítems</th>
              <th className="px-3 py-2.5 text-right">Total est.</th>
              <th className="px-3 py-2.5 text-left">Estado</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-12 text-center">
                <ClipboardList className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Todavía no hay solicitudes.</p>
                <Link href="/compras/solicitudes/nueva" className="mt-1 inline-block text-xs font-semibold hover:underline" style={{ color: TEAL }}>Cargar la primera</Link>
              </td></tr>
            ) : rows.map((s) => {
              const e = ESTADO[s.estado] ?? { label: s.estado, cls: "bg-slate-100 text-slate-600" };
              return (
                <tr key={s.id} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{s.numero_oc}</td>
                  <td className="px-3 py-2">{(s.fecha ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2">{s.proveedor_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{s.usuario_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.cantidad_items}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gs(s.total)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${e.cls}`}>{e.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
