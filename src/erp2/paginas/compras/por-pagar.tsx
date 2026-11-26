"use client";

/**
 * /compras/por-pagar — bandeja de pago (Fase 3, Guillermo).
 *
 * Lista las órdenes ya aprobadas (firmes) según su estado de pago. Al abrir una,
 * Guillermo puede "Confirmar pago" (método y referencia opcionales): la orden pasa
 * a pago confirmado y queda lista para recibir. Versión simple: marca el pago (el
 * registro contable llega en una fase posterior).
 */
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CheckCircle2, Loader2, Wallet, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { Select } from "@/erp2/components/Select";
import { Drawer } from "@/erp2/components/Drawer";
import { gs } from "@/erp2/modules/compras/partes";

const TEAL = clienteConfig.color;

type Fila = {
  id: string;
  numero_oc: string;
  fecha: string;
  proveedor_nombre: string | null;
  estado: string;
  pago_estado: string;
  total: number;
  cantidad_items: number;
  usuario_nombre: string | null;
};
type ItemDetalle = { id: string; producto_nombre: string; cantidad: number; costo_unitario: number };
type Detalle = Fila & {
  observacion: string | null;
  pago_metodo: string | null;
  pago_referencia: string | null;
  pago_confirmado_at: string | null;
  items: ItemDetalle[];
};

const PAGO: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Por pagar", cls: "bg-amber-50 text-amber-700" },
  confirmado: { label: "Pagada", cls: "bg-emerald-50 text-emerald-700" },
};
const FILTROS: [string, string][] = [
  ["pendiente", "Por pagar"],
  ["confirmado", "Pagadas"],
  ["", "Todas"],
];
const METODOS: [string, string][] = [
  ["", "Sin especificar"],
  ["Transferencia", "Transferencia"],
  ["Efectivo", "Efectivo"],
  ["Cheque", "Cheque"],
  ["Tarjeta", "Tarjeta"],
  ["Otro", "Otro"],
];

export default function PorPagarPage() {
  const [rows, setRows] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pago, setPago] = useState("pendiente");
  const [viendo, setViendo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const sp = new URLSearchParams();
    sp.set("pago", pago);
    (async () => {
      try {
        const d = await apiFetch<{ rows: Fila[] }>(`/api/v2/compras/por-pagar?${sp}`);
        if (vivo) { setRows(d.rows ?? []); setError(null); }
      } catch (e) {
        if (vivo) setError((e as Error).message);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [pago, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Compras</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Órdenes por pagar</h1>
          <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">Órdenes aprobadas esperando el pago. Al confirmarlo quedan listas para recibir.</p>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <Select value={pago} onChange={(v) => setPago(v)} minWidth={160} etiqueta="Mostrar" options={FILTROS} />
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Nº</th>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Proveedor</th>
              <th className="px-3 py-2.5 text-right">Ítems</th>
              <th className="px-3 py-2.5 text-right">Total</th>
              <th className="px-3 py-2.5 text-left">Pago</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-12 text-center">
                <Wallet className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">{pago === "pendiente" ? "No hay órdenes esperando pago." : "No hay órdenes para este filtro."}</p>
              </td></tr>
            ) : rows.map((s) => {
              const p = PAGO[s.pago_estado] ?? { label: s.pago_estado, cls: "bg-slate-100 text-slate-600" };
              return (
                <tr key={s.id} onClick={() => setViendo(s.id)} className="cursor-pointer border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{s.numero_oc}</td>
                  <td className="px-3 py-2">{(s.fecha ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2">{s.proveedor_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.cantidad_items}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gs(s.total)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${p.cls}`}>{p.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viendo ? <DetallePago id={viendo} onClose={() => setViendo(null)} onCambio={refrescar} /> : null}
    </div>
  );
}

function DetallePago({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const [o, setO] = useState<Detalle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metodo, setMetodo] = useState("");
  const [referencia, setReferencia] = useState("");

  const cargar = useCallback(() => {
    apiFetch<Detalle>(`/api/v2/ordenes-compra/${id}`).then(setO).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const pendiente = o?.pago_estado !== "confirmado";

  async function confirmar() {
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/v2/compras/por-pagar/${id}/confirmar`, { method: "POST", body: JSON.stringify({ metodo, referencia }) });
      onCambio();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      titulo={o ? `Orden ${o.numero_oc}` : "Orden de compra"}
      subtitulo={o ? `${o.proveedor_nombre ?? "Sin proveedor"}` : undefined}
      onClose={onClose}
      footer={o && pendiente ? (
        <button onClick={confirmar} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: TEAL }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar pago
        </button>
      ) : undefined}
    >
      {!o ? (
        error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/80 p-4">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${(PAGO[o.pago_estado] ?? PAGO.pendiente).cls}`}>{(PAGO[o.pago_estado] ?? PAGO.pendiente).label}</span>
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total</p>
              <p className="text-xl font-bold tabular-nums tracking-tight text-slate-900">{o.total ? gs(o.total) : "—"}</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Productos ({(o.items ?? []).length})</p>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
              {(o.items ?? []).map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 text-sm text-slate-700 [overflow-wrap:anywhere]">{l.producto_nombre}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{Number(l.cantidad).toLocaleString("es-PY")} × {gs(l.costo_unitario)}</span>
                </li>
              ))}
            </ul>
          </div>

          {pendiente ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-800">Datos del pago <span className="font-normal text-slate-400">(opcional)</span></p>
              <div>
                <label className="text-[11px] font-medium text-slate-500">Método</label>
                <div className="mt-0.5"><Select value={metodo} onChange={setMetodo} minWidth={200} options={METODOS} /></div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-500">Referencia / comprobante</label>
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={120} placeholder="Ej: transferencia 00123"
                  className="mt-0.5 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800"><BadgeCheck className="h-4 w-4" /> Pago confirmado</p>
              <p className="mt-0.5 text-xs text-emerald-700">
                {[o.pago_metodo, o.pago_referencia].filter(Boolean).join(" · ") || "Sin datos del pago"}
                {o.pago_confirmado_at ? ` · ${new Date(o.pago_confirmado_at).toLocaleDateString("es-PY")}` : ""}
              </p>
            </div>
          )}

          {o.observacion ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Observación</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{o.observacion}</p>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
              <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
              <button onClick={() => setError(null)} aria-label="Cerrar" className="inline-flex shrink-0 items-center justify-center"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
