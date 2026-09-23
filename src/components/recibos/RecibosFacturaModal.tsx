"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { formatReciboNro } from "@/lib/recibos/recibo-format";

type PagoRecibo = {
  id: string;
  monto: number;
  fecha_pago: string | null;
  metodo_pago: string;
  referencia: string | null;
  recibo_nro: number | null;
};

const METODO_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

function fmtMonto(n: number, moneda: "GS" | "USD"): string {
  if (moneda === "USD") return `USD ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

function fmtFecha(ymd: string | null): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}

/**
 * Modal "Recibos de la factura": lista los pagos CONFIRMADOS de una factura
 * (incluye pagos parciales) y permite ver/imprimir o descargar el recibo de cada uno.
 */
export function RecibosFacturaModal({
  open,
  factura,
  onClose,
}: {
  open: boolean;
  factura: { id: string; numero_factura: string; moneda: "GS" | "USD" } | null;
  onClose: () => void;
}) {
  const [pagos, setPagos] = useState<PagoRecibo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !factura) return;
    let cancelado = false;
    setCargando(true);
    setError(null);
    setPagos([]);
    fetchWithSupabaseSession(`/api/facturas/${factura.id}/pagos`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelado) return;
        if (json?.success && Array.isArray(json.data)) setPagos(json.data as PagoRecibo[]);
        else setError(json?.error ?? "No se pudieron cargar los cobros.");
      })
      .catch(() => {
        if (!cancelado) setError("No se pudieron cargar los cobros.");
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [open, factura]);

  if (!open || !factura) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Recibos de la factura</h3>
            <p className="font-mono text-[11px] text-slate-500">{factura.numero_factura}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {cargando ? (
            <p className="py-8 text-center text-sm text-slate-400">Cargando cobros…</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-500">{error}</p>
          ) : pagos.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              Esta factura todavía no tiene cobros registrados.
              <br />
              El recibo se genera cuando se registra (y aprueba) el pago.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {pagos.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {fmtMonto(p.monto, factura.moneda)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {fmtFecha(p.fecha_pago)} · {METODO_LABEL[p.metodo_pago] ?? p.metodo_pago}
                      {p.recibo_nro != null ? ` · ${formatReciboNro(p.recibo_nro)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={`/api/pagos/${p.id}/recibo`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
                      title="Ver / imprimir recibo"
                    >
                      Ver recibo
                    </a>
                    <a
                      href={`/api/pagos/${p.id}/recibo?download=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[#4FAEB2]/40 hover:text-[#3F8E91]"
                      title="Descargar recibo (PDF)"
                    >
                      Descargar
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
