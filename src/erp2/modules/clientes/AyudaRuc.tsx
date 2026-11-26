"use client";

/**
 * Validación en vivo del RUC de un cliente (dígito verificador de la SET, módulo 11): mensaje
 * claro y el botón "Usar 80011222-9" con el RUC corregido. Sin RUC válido no hay factura
 * (receta 66/84), por eso se avisa al escribir y no recién al facturar.
 */
import { BadgeCheck } from "lucide-react";
import { rucSugerido, validarRuc } from "@/erp2/modules/empresa/tipos";

/** true si el RUC está cargado y no es válido (para bloquear el guardado / marcar el campo). */
export const rucConError = (valor: string) => {
  const e = validarRuc(valor).estado;
  return e === "dv" || e === "incompleto";
};

/** Clase extra del input según el estado del RUC. */
export const claseRuc = (valor: string) =>
  rucConError(valor) ? "!border-rose-300 focus:!border-rose-400 focus:!ring-rose-100" : validarRuc(valor).estado === "ok" ? "!border-emerald-300" : "";

export function AyudaRuc({ valor, onUsar, aviso = false }: {
  valor: string;
  onUsar: (ruc: string) => void;
  /** true: tono de aviso (ámbar), para un documento que puede ser CI; false: error (rojo). */
  aviso?: boolean;
}) {
  const v = validarRuc(valor);
  if (v.estado === "vacio") return null;
  if (v.estado === "ok") {
    return <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /> RUC válido</p>;
  }
  const sugerido = rucSugerido(valor);
  const tono = aviso ? "text-amber-700" : "text-rose-600";
  const boton = aviso ? "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100" : "bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100";
  return (
    <p role="alert" className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${tono}`}>
      <span>{v.mensaje}{aviso && v.estado === "dv" ? " (si es una CI, dejalo así: no se va a poder facturar)" : ""}</span>
      {sugerido ? (
        <button type="button" onClick={() => onUsar(sugerido)}
          className={`inline-flex min-h-7 items-center rounded-md px-2 font-semibold ring-1 transition max-sm:min-h-9 ${boton}`}>
          Usar {sugerido}
        </button>
      ) : null}
    </p>
  );
}
