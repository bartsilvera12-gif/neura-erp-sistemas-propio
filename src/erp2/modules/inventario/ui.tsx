"use client";

/**
 * Piezas visuales compartidas por las pantallas de documentos de Inventario (Traslados,
 * Ajustes y pérdidas, Depósitos): cabecera, pestañas, paginado, modal de documento
 * (CapaModal con cabecera y pie fijos) y el modal "pedir motivo" (anular / rechazar).
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import { clienteConfig } from "@/erp2/cliente.config";
import { ScrollHorizontal } from "@/erp2/components/ScrollHorizontal";

export const TEAL = clienteConfig.color;
export const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] disabled:bg-slate-50 disabled:text-slate-400";
export const INPUT_FILTRO = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
export const ET = "mb-1 block text-xs font-medium text-slate-600";
export const BOTON_PRIMARIO = "inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:opacity-40";
export const BOTON_SECUNDARIO = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50";

/**
 * Acción principal de un documento (traslado, ajuste). Celular / tablet: pie fijo (safe-area).
 * Escritorio: al final de la página, a la derecha, sin caja ni flotar sobre el contenido.
 * Mientras no se puede enviar, el botón va en gris y `falta` dice qué hay que completar.
 */
export function BarraEnvio({ chico, grande, resumen, falta, error, etiqueta, icono, listo, busy, onEnviar, color = TEAL }: {
  /** celular: línea chica y línea grande */
  chico: React.ReactNode;
  grande: React.ReactNode;
  /** escritorio: el resumen del documento (null si todavía no hay nada) */
  resumen: React.ReactNode;
  falta: string | null;
  error: string | null;
  etiqueta: string;
  icono: React.ReactNode;
  listo: boolean;
  busy: boolean;
  onEnviar: () => void;
  color?: string;
}) {
  const boton = (clase: string) => (
    <button type="button" onClick={onEnviar} disabled={!listo || busy}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition active:scale-[0.98] disabled:active:scale-100 ${listo ? "text-white shadow-sm hover:brightness-95" : "bg-slate-200 text-slate-500"} ${busy ? "opacity-70" : ""} ${clase}`}
      style={listo ? { backgroundColor: color } : undefined}>
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : icono}
      <span className="truncate">{etiqueta}</span>
    </button>
  );
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 !mb-0 border-t border-slate-200 bg-white shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.28)] pb-safe lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1">
            {error ? <p className="line-clamp-2 text-xs font-medium text-rose-600">{error}</p> : (
              <>
                <p className={`truncate text-[11px] ${falta ? "font-medium text-amber-700" : "text-slate-500"}`}>{falta ?? chico}</p>
                <div className="truncate text-base font-bold leading-tight text-slate-900">{grande}</div>
              </>
            )}
          </div>
          {boton("h-12 max-w-[60%] px-5")}
        </div>
      </div>

      <div className="hidden items-center justify-end gap-4 lg:flex">
        <div className="min-w-0 text-right text-sm">
          {resumen ? <div className="truncate font-semibold text-slate-800">{resumen}</div> : null}
          {error ? <p className="font-medium text-rose-600">{error}</p> : falta ? <p className={resumen ? "text-xs font-medium text-amber-700" : "font-medium text-slate-600"}>{falta}</p> : null}
        </div>
        {boton("h-11 px-5")}
      </div>
    </>
  );
}

export function Cabecera({ kicker, titulo, subtitulo, volver, children }: {
  kicker: string; titulo: string; subtitulo?: string;
  /** Link "← …" arriba del título (ej. volver al panel de Inventario). */
  volver?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    // Responsive: en celular el título baja a 20 px y las acciones van debajo, a todo el ancho.
    <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {/* Celular: una sola fila (flecha + título); kicker y subtítulo solo en tablet/compu. */}
        {volver ? (
          <Link href={volver.href} className="-ml-1 mb-1.5 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800 max-md:hidden">
            <ArrowLeft className="h-3.5 w-3.5" /> {volver.label}
          </Link>
        ) : null}
        <div className="flex items-center gap-2 max-md:hidden">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>{kicker}</p>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 max-md:mt-0">
          {volver ? (
            <Link href={volver.href} aria-label={`Volver a ${volver.label}`} title={`Volver a ${volver.label}`}
              className="-my-2 -ml-2 inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:hidden">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          ) : null}
          <h1 className="min-w-0 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{titulo}</h1>
        </div>
        {subtitulo ? <p className="mt-1 text-[13px] text-slate-500 max-md:hidden sm:text-sm">{subtitulo}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2 max-sm:[&>*]:min-h-11">{children}</div> : null}
    </header>
  );
}

export function Pestanas({ opciones, valor, onChange }: {
  opciones: { id: string; label: string; badge?: number }[];
  valor: string;
  onChange: (id: string) => void;
}) {
  // Responsive: si no entran, scrollean adentro (con desvanecido en el borde), nunca se cortan
  // ni saltan de línea; la elegida queda a la vista. En celular y tablet miden 40 px de alto.
  return (
    <ScrollHorizontal role="tablist" className="w-fit rounded-xl bg-slate-100/80 p-1" dependencias={[valor]}>
      {opciones.map((o) => {
        const sel = valor === o.id;
        return (
          <button key={o.id} type="button" role="tab" aria-selected={sel} onClick={() => onChange(o.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition max-lg:min-h-10 max-sm:text-[13px] ${sel ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {o.label}
            {o.badge ? (
              <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ${sel ? "bg-[var(--brand)] text-white" : "bg-amber-100 text-amber-700"}`}>{o.badge}</span>
            ) : null}
          </button>
        );
      })}
    </ScrollHorizontal>
  );
}

export function Paginador({ pagina, porPagina, total, cargando, onCambiar }: {
  pagina: number; porPagina: number; total: number; cargando?: boolean; onCambiar: (n: number) => void;
}) {
  if (total <= 0) return null;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const de = (pagina - 1) * porPagina + 1;
  const a = Math.min(pagina * porPagina, total);
  return (
    // Responsive: en celular "Anterior / Siguiente" ocupan el ancho (44 px de alto) y el texto va arriba.
    <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/40 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-3.5">
      <p className="text-center text-xs text-slate-500 sm:text-left">
        Mostrando <span className="font-semibold text-slate-700">{de.toLocaleString("es-PY")}</span>–<span className="font-semibold text-slate-700">{a.toLocaleString("es-PY")}</span> de{" "}
        <span className="font-semibold text-slate-700">{total.toLocaleString("es-PY")}</span>
      </p>
      <div className="flex items-center justify-between gap-1.5 sm:justify-start">
        <button disabled={pagina <= 1 || cargando} onClick={() => onCambiar(pagina - 1)} className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">
          <ChevronLeft className="h-3.5 w-3.5" /> Anterior
        </button>
        <span className="px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-700">{pagina} / {totalPaginas}</span>
        <button disabled={pagina >= totalPaginas || cargando} onClick={() => onCambiar(pagina + 1)} className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">
          Siguiente <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Modal de documento: cabecera y pie fijos, cuerpo con scroll (patrón de CapaModal). */
export function ModalDocumento({ titulo, subtitulo, extra, ancho = "max-w-3xl", z = "z-[110]", onClose, footer, children }: {
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  extra?: React.ReactNode;
  ancho?: string;
  /** capa (ej. z-[130] para abrir encima del detalle de una venta) */
  z?: string;
  onClose?: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <CapaModal onClose={onClose} z={z}>
      <div role="dialog" aria-modal="true"
        className={`flex w-full ${ancho} ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-[var(--brand-400)]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 py-3 pl-4 pr-2 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900 sm:text-lg">{titulo}</h2>
            {subtitulo ? <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {extra}
            {onClose ? (
              <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-6 sm:py-3.5">{footer}</div> : null}
      </div>
    </CapaModal>
  );
}

/** Pide un motivo y confirma (anular, rechazar). */
export function PedirMotivo({ titulo, descripcion, etiqueta = "Motivo", confirmar, onConfirmar, onClose }: {
  titulo: string;
  descripcion: React.ReactNode;
  etiqueta?: string;
  confirmar: string;
  onConfirmar: (motivo: string) => Promise<void>;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ok() {
    if (!motivo.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirmar(motivo.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[130]" fondo="bg-slate-900/40 backdrop-blur-sm">
      <div className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="text-[13px] leading-relaxed text-slate-600">{descripcion}</div>
          <label className="block">
            <span className={ET}>{etiqueta} *</span>
            <textarea autoFocus rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} className={`${INPUT} resize-none`} />
          </label>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Volver</button>
          <button type="button" onClick={ok} disabled={busy || !motivo.trim()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmar}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

/** Dato con etiqueta (fichas de documentos). */
export function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{etiqueta}</p>
      <div className="mt-0.5 truncate text-sm text-slate-800">{children}</div>
    </div>
  );
}
