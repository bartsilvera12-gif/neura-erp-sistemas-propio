"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { hoyYmdLocal } from "@/lib/fechas/calendario";
import { useBancosActivos } from "@/shared/hooks/useBancosActivos";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

/**
 * Ref de la factura desde la que se abre el cobro. `cliente_id` es obligatorio:
 * el modal muestra TODAS las facturas pendientes de ese cliente para permitir
 * cobrar varias con una sola transferencia (cobro múltiple).
 */
export type RegistrarPagoFacturaRef = {
  id: string;
  numero_factura: string;
  saldo: number;
  moneda: "GS" | "USD";
  cliente_id: string;
  cliente_label?: string;
};

type FacturaCliente = {
  id: string;
  numero_factura: string;
  saldo: number;
  estado: string;
  fecha: string | null;
  fecha_vencimiento: string | null;
};

type Fila = { fac: FacturaCliente; checked: boolean; montoStr: string; idem: string };

const COMPROBANTE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const COMPROBANTE_MAX_MB = 8;

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

const soloDigitos = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;
const fmtGs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

export function RegistrarPagoModal({
  open,
  factura,
  onClose,
  onExito,
}: {
  open: boolean;
  factura: RegistrarPagoFacturaRef | null;
  onClose: () => void;
  onExito: () => void | Promise<void>;
}) {
  const [fechaPago, setFechaPago] = useState("");
  const [bancoOrigen, setBancoOrigen] = useState("");
  const [titular, setTitular] = useState("");
  const [numeroOperacion, setNumeroOperacion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const { bancos } = useBancosActivos(open && !!factura);

  const cargarFacturas = useCallback(async (clienteId: string) => {
    setCargando(true);
    try {
      const r = await apiFetch(`/api/facturas?cliente_id=${encodeURIComponent(clienteId)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { data?: FacturaCliente[] };
      const lista = (Array.isArray(j.data) ? j.data : [])
        .filter((f) => Number(f.saldo) > 0 && !["Anulado", "Corregida NC"].includes(String(f.estado)))
        .sort((a, b) => {
          const va = a.fecha_vencimiento ?? a.fecha ?? "";
          const vb = b.fecha_vencimiento ?? b.fecha ?? "";
          return va < vb ? -1 : va > vb ? 1 : 0;
        });
      setFilas(
        lista.map((f) => ({ fac: f, checked: true, montoStr: fmtGs(Number(f.saldo)).replace("Gs. ", ""), idem: uuid() }))
      );
    } catch {
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !factura) return;
    setFechaPago(hoyYmdLocal());
    setBancoOrigen("");
    setTitular("");
    setNumeroOperacion("");
    setFile(null);
    setErrorMsg(null);
    setDoneMsg(null);
    void cargarFacturas(factura.cliente_id);
  }, [open, factura?.cliente_id, cargarFacturas]);

  if (!open || !factura) return null;

  const seleccionadas = filas.filter((r) => r.checked);
  const total = seleccionadas.reduce((s, r) => s + soloDigitos(r.montoStr), 0);
  const todasTildadas = filas.length > 0 && filas.every((r) => r.checked);

  function setFila(id: string, patch: Partial<Fila>) {
    setFilas((prev) => prev.map((r) => (r.fac.id === id ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (seleccionadas.length === 0) return setErrorMsg("Tildá al menos una factura.");
    for (const r of seleccionadas) {
      const m = soloDigitos(r.montoStr);
      if (m <= 0) return setErrorMsg(`Ingresá un monto válido para ${r.fac.numero_factura}.`);
      if (m > Number(r.fac.saldo)) return setErrorMsg(`El monto de ${r.fac.numero_factura} supera su saldo.`);
    }
    if (!bancoOrigen.trim()) return setErrorMsg("Indicá el banco de origen.");
    if (!titular.trim()) return setErrorMsg("Indicá el titular (quién envía).");
    if (!numeroOperacion.trim()) return setErrorMsg("Indicá el número de comprobante / operación.");
    if (!file) return setErrorMsg("Adjuntá el comprobante de la transferencia.");
    if (file.size > COMPROBANTE_MAX_MB * 1024 * 1024) return setErrorMsg(`El comprobante supera ${COMPROBANTE_MAX_MB} MB.`);

    setGuardando(true);
    setErrorMsg(null);
    try {
      const items = seleccionadas.map((r) => ({ factura_id: r.fac.id, monto: soloDigitos(r.montoStr), idempotency_key: r.idem }));
      const fd = new FormData();
      fd.set("cliente_id", factura!.cliente_id);
      fd.set("fecha", fechaPago);
      fd.set("banco_origen", bancoOrigen.trim());
      fd.set("titular", titular.trim());
      fd.set("numero_operacion", numeroOperacion.trim());
      fd.set("items", JSON.stringify(items));
      fd.set("file", file, file.name);

      const r = await apiFetch("/api/cobranzas/conciliacion/multiple", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: { warning?: string } };
      setGuardando(false);
      if (!r.ok || !j?.success) {
        setErrorMsg(j?.error || "No se pudo registrar el cobro. Verificá los datos y volvé a intentar.");
        return;
      }
      await Promise.resolve(onExito());
      setDoneMsg(
        j.data?.warning ||
          `${seleccionadas.length} ${seleccionadas.length === 1 ? "factura enviada" : "facturas enviadas"} a aprobación en Conciliación bancaria. El saldo se actualiza cuando un administrador lo apruebe.`
      );
    } catch (err) {
      setGuardando(false);
      setErrorMsg(err instanceof Error ? err.message : "Error de red. Volvé a intentar.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="mb-1 text-lg font-bold text-gray-800">Registrar cobro</h3>
        <p className="mb-4 text-xs text-slate-500">
          {factura.cliente_label ? <>Cliente: <b>{factura.cliente_label}</b> · </> : null}
          Cobro por transferencia. Queda <b>pendiente de aprobación</b> en Conciliación bancaria.
        </p>

        {doneMsg ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">✅ {doneMsg}</div>
            <button type="button" onClick={onClose} className="rounded-lg bg-[#3F8E91] px-4 py-2 text-sm font-medium text-white hover:bg-[#357a7d]">
              Listo
            </button>
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{errorMsg}</div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className={labelClass}>Facturas pendientes</span>
                  {filas.length > 0 && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[#3F8E91]">
                      <input
                        type="checkbox"
                        checked={todasTildadas}
                        onChange={(e) => setFilas((prev) => prev.map((r) => ({ ...r, checked: e.target.checked })))}
                      />
                      Seleccionar todas
                    </label>
                  )}
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                  {cargando ? (
                    <p className="px-3 py-4 text-center text-sm text-slate-400">Cargando facturas…</p>
                  ) : filas.length === 0 ? (
                    <p className="px-3 py-4 text-center text-sm text-slate-500">Este cliente no tiene facturas pendientes.</p>
                  ) : (
                    filas.map((r) => (
                      <div key={r.fac.id} className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2 last:border-0">
                        <input type="checkbox" checked={r.checked} onChange={(e) => setFila(r.fac.id, { checked: e.target.checked })} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-800">
                            {r.fac.numero_factura}
                            {r.fac.fecha_vencimiento ? (
                              <span className="text-slate-400"> · vence {String(r.fac.fecha_vencimiento).slice(0, 10)}</span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-slate-500">Saldo {fmtGs(Number(r.fac.saldo))}</div>
                        </div>
                        <input
                          value={r.montoStr}
                          onChange={(e) => setFila(r.fac.id, { montoStr: e.target.value })}
                          disabled={!r.checked}
                          inputMode="numeric"
                          className={`w-28 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm text-slate-800 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/30 disabled:opacity-40`}
                        />
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-500">Total a cobrar</span>
                  <span className="text-base font-semibold text-slate-800">{fmtGs(total)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="rp-fecha">Fecha de la transferencia</label>
                  <input id="rp-fecha" type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass} htmlFor="rp-banco">Banco de origen</label>
                  <select id="rp-banco" value={bancoOrigen} onChange={(e) => setBancoOrigen(e.target.value)} className={inputClass} required>
                    <option value="">— Seleccioná el banco —</option>
                    {bancos.map((b) => (
                      <option key={b.id} value={b.nombre}>{b.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="rp-titular">Titular (quién envía)</label>
                  <input
                    id="rp-titular"
                    type="text"
                    value={titular}
                    onChange={(e) => setTitular(e.target.value.toUpperCase())}
                    className={`${inputClass} uppercase placeholder:normal-case`}
                    placeholder="Titular de la cuenta que envía"
                    required
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="rp-nro">N° de comprobante / operación</label>
                  <input id="rp-nro" type="text" value={numeroOperacion} onChange={(e) => setNumeroOperacion(e.target.value)} className={inputClass} placeholder="Nº de operación" required />
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="rp-file">Comprobante <span className="text-slate-400">(obligatorio — JPG, PNG, WebP o PDF)</span></label>
                <input
                  id="rp-file"
                  type="file"
                  accept={COMPROBANTE_ACCEPT}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={guardando || cargando} className="rounded-lg bg-[#3F8E91] px-4 py-2 text-sm font-medium text-white hover:bg-[#357a7d] disabled:opacity-50">
                  {guardando ? "Enviando…" : "Enviar a aprobación"}
                </button>
                <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
