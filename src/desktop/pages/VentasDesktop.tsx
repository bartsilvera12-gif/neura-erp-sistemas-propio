"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { NuevaFacturaCajaModal } from "@/components/caja/NuevaFacturaCajaModal";

export default function VentasPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
          />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Comercial</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Caja</h1>
        <p className="mt-1 text-sm text-slate-500">Emisión rápida de facturas</p>
      </div>

      {/* Botón central */}
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-24 shadow-sm">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl bg-[#4FAEB2] px-8 py-4 text-base font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91]"
        >
          <FileText className="h-5 w-5" />
          Nueva factura
        </button>
        <p className="mt-3 max-w-xs text-center text-xs text-slate-400">
          Creá una factura con nombre, RUC, descripción, monto, IVA y fecha de emisión.
        </p>
      </div>

      <NuevaFacturaCajaModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
