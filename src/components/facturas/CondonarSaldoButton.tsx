"use client";

import { useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Acción "Condonar saldo" para una factura parcialmente pagada (SOLO admin).
 * Abre un modal: tipo (Condonado / Incobrable) + motivo obligatorio, y hace
 * POST /api/facturas/[id]/condonar-saldo. Pone el saldo en 0, deja la factura
 * Pagada con etiqueta de condonación y genera el asiento (si estaba contabilizada).
 * No toca los pagos ya registrados. El backend valida permisos y estado.
 */
export function CondonarSaldoButton({
  facturaId,
  saldo,
  estado,
  numeroFactura,
  variant = "full",
  onCondonada,
}: {
  facturaId: string;
  saldo: number;
  estado: string;
  numeroFactura?: string | null;
  variant?: "full" | "compact";
  onCondonada?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<"condonado" | "incobrable">("condonado");
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const est = String(estado ?? "").trim();
  // Solo aplica a facturas con saldo pendiente y no terminales.
  if (!(saldo > 0) || est === "Anulado" || est === "Corregida NC") return null;

  async function handleConfirmar() {
    setError(null);
    const m = motivo.trim();
    if (m.length < 5) {
      setError("El motivo debe tener al menos 5 caracteres.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/condonar-saldo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, motivo: m }),
      });
      const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setError(j.error ?? `Error ${res.status}`);
        return;
      }
      setOpen(false);
      setMotivo("");
      await onCondonada?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setSubmitting(false);
    }
  }

  const triggerCls =
    variant === "compact"
      ? "inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-700 transition-colors hover:border-amber-400 hover:bg-amber-50"
      : "inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-700 transition-colors hover:border-amber-400 hover:bg-amber-50";

  const fmt = (v: number) => Math.round(Number(v) || 0).toLocaleString("es-PY");

  return (
    <>
      <button
        type="button"
        onClick={() => { setTipo("condonado"); setMotivo(""); setError(null); setOpen(true); }}
        className={triggerCls}
        title="Condonar / dar por incobrable el saldo pendiente"
      >
        Condonar saldo
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !submitting && setOpen(false)}
        >
          <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-slate-900">Condonar saldo{numeroFactura ? ` — ${numeroFactura}` : ""}</h4>
            <p className="text-xs leading-relaxed text-slate-600">
              Cierra el <span className="font-semibold">saldo pendiente de Gs. {fmt(saldo)}</span>: lo pone en 0 y marca la
              factura como pagada (condonada). Registra el asiento contable de la pérdida (Descuentos/Incobrables) y
              <span className="font-semibold"> no toca los pagos ya registrados</span>. Queda auditado.
            </p>
            <div>
              <span className="mb-1 block text-xs font-semibold text-slate-600">Tratamiento</span>
              <div className="flex gap-2">
                {([["condonado", "Condonado"], ["incobrable", "Incobrable"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setTipo(val)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      tipo === val ? "border-amber-400 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-xs font-semibold text-slate-600">
              Motivo (obligatorio)
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                placeholder="Ej.: el cliente abonó la mayor parte y no cancelará el resto"
              />
            </label>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" disabled={submitting} onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" disabled={submitting} onClick={() => void handleConfirmar()} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                {submitting ? "Procesando…" : "Condonar saldo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
