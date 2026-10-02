"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { hoyYmdLocal } from "@/lib/fechas/calendario";

const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";
const LABEL = "block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1";

type IvaTipo = "iva_10" | "iva_5" | "exenta";

type FacturaCreada = { id: string; numero_factura?: string };

const soloDigitos = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;
const fmtGs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;

export function NuevaFacturaCajaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [montoStr, setMontoStr] = useState("");
  const [iva, setIva] = useState<IvaTipo>("iva_10");
  const [fecha, setFecha] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<FacturaCreada | null>(null);

  useEffect(() => {
    if (open) {
      setNombre("");
      setRuc("");
      setDescripcion("");
      setMontoStr("");
      setIva("iva_10");
      setFecha(hoyYmdLocal());
      setError(null);
      setCreada(null);
      setGuardando(false);
    }
  }, [open]);

  if (!open) return null;

  const monto = soloDigitos(montoStr);

  async function crear() {
    setError(null);
    const nom = nombre.trim();
    const rucT = ruc.trim();
    if (!nom) return setError("Indicá el nombre o razón social.");
    if (!rucT) return setError("Indicá el RUC.");
    if (monto <= 0) return setError("El monto debe ser mayor a 0.");
    if (!fecha) return setError("Indicá la fecha de emisión.");
    setGuardando(true);
    try {
      // 1) Cliente por RUC (busca o crea)
      const rc = await fetchWithSupabaseSession("/api/caja/cliente-por-ruc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nom, ruc: rucT }),
      });
      const rcj = await rc.json();
      if (!rcj?.success || !rcj.data?.cliente_id) throw new Error(rcj?.error ?? "No se pudo resolver el cliente");
      const clienteId = String(rcj.data.cliente_id);

      // 2) Factura contado con la fecha elegida
      const rf = await fetchWithSupabaseSession("/api/facturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          fecha,
          monto,
          tipo: "contado",
          moneda: "GS",
          descripcion_linea: descripcion.trim() || "Servicio",
          iva_tipo: iva,
        }),
      });
      const rfj = await rf.json();
      if (!rf.ok || !rfj?.success || !rfj.data?.id) throw new Error(rfj?.error ?? "No se pudo crear la factura");
      setCreada({ id: String(rfj.data.id), numero_factura: rfj.data.numero_factura });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear la factura");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-900">Nueva factura</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Cerrar">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {creada ? (
          <div className="px-5 py-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-900">
              Factura creada{creada.numero_factura ? ` · ${creada.numero_factura}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-500">Ya podés abrirla para emitir el documento electrónico (SIFEN).</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Link
                href={`/facturas/${creada.id}`}
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]"
              >
                Ver / Emitir factura
              </Link>
              <button
                type="button"
                onClick={() => setCreada(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cargar otra
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 px-5 py-4">
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Nombre / Razón social *</label>
                <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Comercial San Jorge S.A." />
              </div>
              <div>
                <label className={LABEL}>RUC *</label>
                <input className={INPUT} value={ruc} onChange={(e) => setRuc(e.target.value)} placeholder="Ej: 80012345-6" />
              </div>
            </div>
            <div>
              <label className={LABEL}>Descripción del servicio</label>
              <input className={INPUT} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Honorarios profesionales septiembre" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={LABEL}>Monto *</label>
                <input
                  className={INPUT}
                  inputMode="numeric"
                  value={montoStr}
                  onChange={(e) => setMontoStr(e.target.value)}
                  placeholder="0"
                />
                {monto > 0 && <p className="mt-1 text-[11px] text-slate-400">{fmtGs(monto)} (IVA incluido)</p>}
              </div>
              <div>
                <label className={LABEL}>Tipo de IVA</label>
                <select className={INPUT} value={iva} onChange={(e) => setIva(e.target.value as IvaTipo)}>
                  <option value="iva_10">IVA 10%</option>
                  <option value="iva_5">IVA 5%</option>
                  <option value="exenta">Exenta</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Fecha de emisión</label>
                <input className={INPUT} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={crear}
                disabled={guardando}
                className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-50"
              >
                {guardando ? "Creando…" : "Crear factura"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
