"use client";

/**
 * Piezas de las órdenes de pago a proveedores: el detalle ("Ver") y la anulación con
 * motivo. Las usan la pantalla de Pagos y el estado de cuenta del proveedor.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Ban, Loader2, Printer, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";
import { dinero, hrefOrigenCxp, nombreMetodoPago, type PagoProveedor } from "@/erp2/modules/compras/pagos";
import { imprimirOrdenPago } from "@/erp2/modules/compras/RegistrarPagoProveedor";

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function DetallePago({ id, puedeAnular, onClose, onAnular }: { id: string; puedeAnular: boolean; onClose: () => void; onAnular: (p: PagoProveedor) => void }) {
  const [p, setP] = useState<PagoProveedor | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<PagoProveedor>(`/api/pagos-proveedores/${id}`).then(setP).catch((e) => setError((e as Error).message));
  }, [id]);
  const din = (v: number) => dinero(v, p?.moneda ?? "GS");

  return (
    <CapaModal onClose={onClose} z="z-[110]">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-lg ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Orden de pago {p?.numero ?? ""}</h2>
            <p className="truncate text-sm text-slate-500">{p ? `${p.proveedor_nombre} · ${fechaHora(p.fecha)}` : "Cargando…"}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {!p ? (
            error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
          ) : (
            <>
              {p.anulado_at ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <p className="font-semibold">Orden de pago anulada</p>
                  <p className="text-xs">{p.anulado_motivo}{p.anulado_por ? ` · ${p.anulado_por}` : ""} · {fechaHora(p.anulado_at)}</p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-xl bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-500">Total pagado</span>
                <span className={`text-xl font-bold tabular-nums ${p.anulado_at ? "text-slate-400 line-through" : "text-slate-900"}`}>{din(p.total)}</span>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Medios de pago</p>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                  {p.medios.map((m, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <span className="min-w-0 text-slate-700 [overflow-wrap:anywhere]">{nombreMetodoPago(m.metodo)}{m.referencia ? <span className="ml-2 text-xs text-slate-500">{m.referencia}</span> : null}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-900">{din(m.monto)}</span>
                    </li>
                  ))}
                </ul>
                {p.caja_id ? <p className="mt-1 text-[11px] text-slate-400">El efectivo salió de la caja.</p> : null}
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Facturas que se pagaron</p>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                  {(p.aplicaciones ?? []).map((a) => (
                    <li key={a.cxp_id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-slate-800">{a.numero}</span>
                        {a.compra_numero ? <Link href={hrefOrigenCxp(a)} className="ml-2 font-mono text-xs text-[var(--brand)] hover:underline max-sm:inline-flex max-sm:min-h-9 max-sm:items-center">{a.compra_numero}</Link> : null}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-emerald-700">{din(a.monto)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {p.observacion ? <p className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">{p.observacion}</p> : null}
              <p className="text-xs text-slate-400">Registró: {p.usuario_nombre ?? "—"}</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          {p && !p.anulado_at && puedeAnular ? (
            <button onClick={() => onAnular(p)} className="mr-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 max-sm:flex-1 max-sm:px-2">
              <Ban className="h-4 w-4" /> Anular
            </button>
          ) : null}
          {p ? (
            <button onClick={() => imprimirOrdenPago(p.id, p.numero).catch(() => {})} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1 max-sm:px-2">
              <Printer className="h-4 w-4" /> <span className="sm:hidden">PDF</span><span className="max-sm:hidden">Orden de pago (PDF)</span>
            </button>
          ) : null}
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1 max-sm:px-2">Cerrar</button>
        </div>
      </div>
    </CapaModal>
  );
}

export function AnularPago({ pago, onClose, onAnulado }: { pago: { id: string; numero: string; total: number; moneda: string }; onClose: () => void; onAnulado: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function anular() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/pagos-proveedores/${pago.id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
      onAnulado();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]" fondo="bg-slate-900/40 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <h3 className="shrink-0 px-4 pt-5 text-lg font-semibold text-slate-900 [overflow-wrap:anywhere] sm:px-6 sm:pt-6">¿Anular la orden de pago {pago.numero}?</h3>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
          <p className="mt-1 text-sm text-slate-500">Por {dinero(pago.total, pago.moneda)}. La deuda vuelve a esas facturas y, si fue en efectivo, el egreso de caja se anula.</p>
          <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} enterKeyHint="done" placeholder="¿Por qué la anulás? Ej: se cargó al proveedor equivocado"
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" />
          {error ? <p className="mt-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2 px-4 pt-4 pb-5 sm:px-6 sm:pt-5 sm:pb-6">
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 max-sm:flex-1">Volver</button>
          <button onClick={anular} disabled={busy || !motivo.trim()} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40 max-sm:flex-[2] max-sm:px-3">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Anular orden de pago
          </button>
        </div>
      </div>
    </CapaModal>
  );
}
