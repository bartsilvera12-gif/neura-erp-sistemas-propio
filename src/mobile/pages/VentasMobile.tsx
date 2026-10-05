"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { NuevaFacturaCajaModal } from "@/components/caja/NuevaFacturaCajaModal";

export default function VentasMobile() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <header className="mb-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Caja</h1>
        <p className="text-sm text-slate-500">Emisión rápida de facturas</p>
      </header>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 shadow-sm">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl bg-[#4FAEB2] px-7 py-4 text-base font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91]"
        >
          <FileText className="h-5 w-5" />
          Nueva factura
        </button>
        <p className="mt-3 max-w-[16rem] text-center text-xs text-slate-400">
          Nombre, RUC, descripción, monto, IVA y fecha de emisión.
        </p>
      </div>

      <NuevaFacturaCajaModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
