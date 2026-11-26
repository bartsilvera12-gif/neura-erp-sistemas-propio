"use client";

/**
 * Aviso (ámbar) de un turno de caja abierto hace más de 24 h: el arqueo y las ventas del turno
 * mezclan varios días. No bloquea vender: solo invita a cerrar y abrir uno nuevo.
 */
import { AlertTriangle, Lock } from "lucide-react";
import { haceDias, turnoViejo } from "@/erp2/modules/caja/turno";

export function AvisoTurnoViejo({ fechaApertura, onCerrar, compacto = false, className = "" }: {
  fechaApertura: string | null | undefined;
  onCerrar?: () => void;
  /** Una sola línea (caja de venta, donde el alto cuenta). */
  compacto?: boolean;
  className?: string;
}) {
  const v = turnoViejo(fechaApertura);
  if (!v) return null;
  const texto = `Este turno está abierto desde el ${v.fecha} (${haceDias(v.dias)}). Cerralo y abrí uno nuevo para que el arqueo sea del día.`;
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 ${compacto ? "px-3 py-1.5 text-xs" : "px-3.5 py-2.5 text-sm"} ${className}`}>
      <p className="flex min-w-0 flex-1 items-start gap-2">
        <AlertTriangle className={`mt-0.5 shrink-0 text-amber-600 ${compacto ? "h-3.5 w-3.5" : "h-4 w-4"}`} aria-hidden />
        <span>{texto}</span>
      </p>
      {onCerrar ? (
        <button type="button" onClick={onCerrar}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 max-sm:w-full max-sm:justify-center lg:min-h-8">
          <Lock className="h-3.5 w-3.5" /> Ir a cerrar caja
        </button>
      ) : null}
    </div>
  );
}
