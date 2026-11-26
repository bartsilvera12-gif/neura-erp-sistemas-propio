"use client";

/**
 * Hoja inferior (bottom sheet) sobre CapaModal: en celular se apoya abajo a todo el ancho
 * (cabecera y pie fijos, cuerpo scrolleable, safe-area, por encima del teclado); en tablet /
 * escritorio se ve como un modal centrado chico. La usan los filtros de BarraFiltros, el menú
 * "⋯" de AccionesPagina y las listas de Select / MenuAcciones / ColorPicker en celular.
 *
 *   <HojaInferior titulo="Filtros" onClose={cerrar} pie={<button …>Ver resultados</button>}>
 *     …contenido…
 *   </HojaInferior>
 */
import { X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";

export function HojaInferior({
  titulo,
  onClose,
  children,
  pie,
  z = "z-[150]",
  ancho = "sm:max-w-md",
  sinPadding = false,
  panelRef,
}: {
  titulo?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** acciones fijas abajo (ej. "Limpiar" · "Ver resultados") */
  pie?: React.ReactNode;
  z?: string;
  /** ancho máximo en tablet/escritorio */
  ancho?: string;
  /** el cuerpo sin padding (listas de opciones que manejan su propio espaciado) */
  sinPadding?: boolean;
  panelRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <CapaModal onClose={onClose} z={z} fondo="bg-slate-900/40 backdrop-blur-[2px]">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof titulo === "string" ? titulo : undefined}
        className={`flex w-full ${ancho} ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Agarradera visual (sólo celular) */}
        <div aria-hidden className="flex shrink-0 justify-center pt-2 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        {titulo ? (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 py-1.5 pl-4 pr-1.5 sm:py-2.5 sm:pl-5 sm:pr-3">
            <h2 className="min-w-0 truncate text-[15px] font-semibold text-slate-900">{titulo}</h2>
            <button type="button" onClick={onClose} aria-label="Cerrar"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:h-9 sm:w-9">
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : null}
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${sinPadding ? "" : "px-4 py-4 sm:px-5"}`}>{children}</div>
        {pie ? <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 bg-white px-4 py-3 sm:px-5">{pie}</div> : null}
      </div>
    </CapaModal>
  );
}
