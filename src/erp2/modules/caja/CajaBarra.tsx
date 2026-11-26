"use client";

/**
 * Barra de la caja en el POS: en qué caja se está vendiendo (caja · sucursal · turno ·
 * depósito), cambiar de caja si el usuario tiene varias abiertas, y las acciones del turno
 * (retiro / ingreso de efectivo, ver turno, cerrar). Sin caja abierta: abrir.
 */
import { ArrowLeftRight, Eye, Lock, Unlock } from "lucide-react";
import { Select } from "@/erp2/components/Select";
import { TEAL } from "@/erp2/modules/inventario/ui";
import { etiquetaCaja, type CajaAbierta, type EstadoCajas } from "@/erp2/modules/caja/turno";

export function CajaBarra({ estado, caja, onElegir, onAbrir, onMov, onVer, onCerrar }: {
  estado: EstadoCajas | null;
  caja: CajaAbierta | null;
  onElegir: (turnoId: string) => void;
  onAbrir: () => void;
  onMov: () => void;
  onVer: () => void;
  onCerrar: () => void;
}) {
  if (!estado) {
    return <div className="h-[58px] animate-pulse rounded-2xl border border-slate-200 bg-white" />;
  }
  const abiertas = estado.abiertas;

  if (!caja) {
    const hayQueElegir = abiertas.length > 1;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-900">{hayQueElegir ? "Elegí en qué caja vas a vender" : "No hay una caja abierta"}</p>
            <p className="text-xs text-amber-800/80">{hayQueElegir ? "Hay varias cajas abiertas que podés usar." : "Para vender primero abrí una caja de tu sucursal."}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
          {hayQueElegir ? (
            <Select value="" onChange={(v) => v && onElegir(v)} minWidth={240}
              etiqueta="Caja" options={[["", "Elegí la caja…"], ...abiertas.map((c): [string, string] => [c.id, `${etiquetaCaja(c)}${c.mia ? " (la tuya)" : ""}`])]} />
          ) : null}
          <button type="button" onClick={onAbrir} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 max-sm:min-h-11 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
            <Unlock className="h-4 w-4" /> Abrir caja
          </button>
        </div>
      </div>
    );
  }

  return (
    // Celular: datos de la caja a la izquierda (recortados) y las 3 acciones como íconos de 44 px.
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/70 to-white py-2 pl-3 pr-2 shadow-sm ring-1 ring-emerald-500/5 sm:flex-wrap sm:gap-3 sm:px-4 sm:py-2.5 xl:flex-nowrap xl:py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:flex-none sm:gap-3 xl:flex-1">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        {/* Escritorio ancho: el selector y los datos del turno en un solo renglón (menos alto). */}
        <div className="min-w-0 xl:flex xl:items-center xl:gap-3">
          {abiertas.length > 1 ? (
            <Select value={caja.id} onChange={onElegir} compacto minWidth={250} etiqueta="Caja en la que vendés" className="max-sm:!min-w-0"
              options={abiertas.map((c): [string, string] => [c.id, `${etiquetaCaja(c)}${c.mia ? " (la tuya)" : ""}`])} />
          ) : (
            <p className="truncate text-sm font-semibold text-slate-900">{etiquetaCaja(caja)}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <button type="button" onClick={onMov} title="Retiro o ingreso de efectivo" aria-label="Retiro o ingreso de efectivo" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 max-lg:min-h-11 max-sm:w-11 max-sm:px-0">
          <ArrowLeftRight className="h-3.5 w-3.5 text-slate-400" /> <span className="hidden sm:inline">Retiro / ingreso</span>
        </button>
        <button type="button" onClick={onVer} title="Ver el turno" aria-label="Ver el turno" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 max-lg:min-h-11 max-sm:w-11 max-sm:px-0">
          <Eye className="h-3.5 w-3.5 text-slate-400" /> <span className="hidden sm:inline">Turno</span>
        </button>
        <button type="button" onClick={onCerrar} aria-label="Cerrar caja" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50 max-lg:min-h-11 max-sm:w-11 max-sm:px-0">
          <Lock className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Cerrar caja</span>
        </button>
      </div>
    </div>
  );
}
