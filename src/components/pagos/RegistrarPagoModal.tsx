"use client";

import { useEffect, useState } from "react";
import MontoInput, { parseMontoInput } from "@/components/ui/MontoInput";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { hoyYmdLocal } from "@/lib/fechas/calendario";
import { useBancosActivos } from "@/shared/hooks/useBancosActivos";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

export type RegistrarPagoFacturaRef = {
  id: string;
  numero_factura: string;
  saldo: number;
  moneda: "GS" | "USD";
};

// Comprobante: mismos límites que el endpoint de conciliación.
const COMPROBANTE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const COMPROBANTE_MAX_MB = 8;

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

function saldoDescripcion(f: RegistrarPagoFacturaRef) {
  if (f.moneda === "USD") {
    return `Factura ${f.numero_factura} — Saldo: USD ${f.saldo.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }
  return `Factura ${f.numero_factura} — Saldo: Gs. ${f.saldo.toLocaleString("es-PY")}`;
}

/**
 * Registro de cobro (SOLO transferencia). NO confirma el pago: crea un cobro
 * PENDIENTE en Conciliación bancaria. El saldo baja recién cuando un admin lo
 * aprueba. Reusa `POST /api/cobranzas/conciliacion` (registrarTransferencia +
 * subida de comprobante + anti-duplicado por banco+Nº de operación).
 */
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
  const [monto, setMonto] = useState("");
  const [fechaPago, setFechaPago] = useState("");
  const [bancoOrigen, setBancoOrigen] = useState("");
  const [titular, setTitular] = useState("");
  const [numeroOperacion, setNumeroOperacion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const { bancos } = useBancosActivos(open && !!factura);

  useEffect(() => {
    if (!open || !factura) return;
    setMonto(String(factura.saldo));
    setFechaPago(hoyYmdLocal());
    setBancoOrigen("");
    setTitular("");
    setNumeroOperacion("");
    setFile(null);
    setIdemKey(uuid());
    setErrorMsg(null);
    setDoneMsg(null);
  }, [open, factura?.id, factura?.saldo, factura?.moneda, factura?.numero_factura]);

  if (!open || !factura) return null;

  const f = factura;
  const decimals = f.moneda === "USD";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const m = parseMontoInput(String(monto));
    if (m > f.saldo) {
      setErrorMsg("El monto del cobro no puede superar el saldo pendiente de la factura.");
      return;
    }
    if (m <= 0) {
      setErrorMsg("Ingresá un monto mayor a cero.");
      return;
    }
    if (!bancoOrigen.trim()) {
      setErrorMsg("Indicá el banco desde el que se envió la transferencia.");
      return;
    }
    if (!titular.trim()) {
      setErrorMsg("Indicá el titular (quién envía la transferencia).");
      return;
    }
    if (!numeroOperacion.trim()) {
      setErrorMsg("Indicá el número de comprobante / operación.");
      return;
    }
    if (!file) {
      setErrorMsg("Adjuntá el comprobante de la transferencia.");
      return;
    }
    if (file.size > COMPROBANTE_MAX_MB * 1024 * 1024) {
      setErrorMsg(`El comprobante supera ${COMPROBANTE_MAX_MB} MB.`);
      return;
    }
    setGuardando(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.set("factura_id", f.id);
      fd.set("monto", String(m));
      fd.set("fecha", fechaPago);
      fd.set("banco_origen", bancoOrigen.trim());
      fd.set("titular", titular.trim());
      fd.set("numero_operacion", numeroOperacion.trim());
      fd.set("idempotency_key", idemKey);
      if (file) fd.set("file", file, file.name);

      const r = await apiFetch("/api/cobranzas/conciliacion", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      setGuardando(false);
      if (!r.ok || !j?.success) {
        setErrorMsg(j?.error || "No se pudo registrar el cobro. Verificá los datos y volvé a intentar.");
        return;
      }
      await Promise.resolve(onExito());
      // El endpoint puede devolver un warning (p.ej. comprobante en formato no permitido).
      setDoneMsg(
        j.data?.warning
          ? String(j.data.warning)
          : "Cobro registrado y enviado a aprobación en Conciliación bancaria. El saldo se actualiza cuando un administrador lo apruebe."
      );
    } catch (err) {
      setGuardando(false);
      setErrorMsg(err instanceof Error ? err.message : "Error de red. Volvé a intentar.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="registrar-pago-titulo"
      >
        <h3 id="registrar-pago-titulo" className="mb-1 text-lg font-bold text-gray-800">
          Registrar cobro
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Cobro por transferencia. Queda <b>pendiente de aprobación</b> en Conciliación bancaria.
          Todos los campos son obligatorios.
        </p>
        <p className="mb-4 text-sm text-slate-600">{saldoDescripcion(f)}</p>

        {doneMsg ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              ✅ {doneMsg}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#3F8E91] px-4 py-2 text-sm font-medium text-white hover:bg-[#357a7d]"
            >
              Listo
            </button>
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {errorMsg}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="reg-pago-monto">
                  Monto
                </label>
                <MontoInput
                  id="reg-pago-monto"
                  value={monto}
                  onChange={(n) => setMonto(String(n))}
                  className={inputClass}
                  decimals={decimals}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="reg-pago-fecha">
                  Fecha de la transferencia
                </label>
                <input
                  id="reg-pago-fecha"
                  type="date"
                  value={fechaPago}
                  onChange={(e) => setFechaPago(e.target.value)}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="reg-pago-banco">
                  Banco de origen
                </label>
                <select
                  id="reg-pago-banco"
                  value={bancoOrigen}
                  onChange={(e) => setBancoOrigen(e.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">— Seleccioná el banco —</option>
                  {bancos.map((b) => (
                    <option key={b.id} value={b.nombre}>{b.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="reg-pago-titular">
                  Titular (quién envía)
                </label>
                <input
                  id="reg-pago-titular"
                  type="text"
                  value={titular}
                  onChange={(e) => setTitular(e.target.value.toUpperCase())}
                  className={`${inputClass} uppercase placeholder:normal-case`}
                  placeholder="Nombre del titular de la cuenta que envía"
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="reg-pago-nro">
                  N° de comprobante / operación
                </label>
                <input
                  id="reg-pago-nro"
                  type="text"
                  value={numeroOperacion}
                  onChange={(e) => setNumeroOperacion(e.target.value)}
                  className={inputClass}
                  placeholder="Nº de operación de la transferencia"
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="reg-pago-file">
                  Comprobante <span className="text-slate-400">(obligatorio — JPG, PNG, WebP o PDF)</span>
                </label>
                <input
                  id="reg-pago-file"
                  type="file"
                  accept={COMPROBANTE_ACCEPT}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={guardando}
                  className="rounded-lg bg-[#3F8E91] px-4 py-2 text-sm font-medium text-white hover:bg-[#357a7d] disabled:opacity-50"
                >
                  {guardando ? "Enviando…" : "Enviar a aprobación"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
                >
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
