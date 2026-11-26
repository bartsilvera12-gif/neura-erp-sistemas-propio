"use client";

/**
 * Patrón común de encabezado de página, acciones, barra de filtros y cifras (KPIs), responsive.
 *
 *   <EncabezadoPagina kicker="Base" titulo="Clientes" subtitulo="…"
 *     acciones={<AccionesPagina acciones={[
 *       { etiqueta: "Nuevo cliente", icono: <Plus/>, onClick: nuevo, primaria: true },
 *       { etiqueta: "Exportar Excel", icono: <Download/>, onClick: exportar, cargando: exportando },
 *     ]} />} />
 *
 *   · EncabezadoPagina: kicker + título (20 px en celular, 24 en escritorio) + subtítulo y, a la
 *     derecha (debajo en celular), las acciones. `volver` agrega "← Volver".
 *   · AccionesPagina: en ≥ 640 px todos los botones en fila; en celular quedan a la vista las
 *     `primaria` (44 px, se reparten el ancho) y el resto va a un menú "⋯" (hoja inferior).
 *     Alternativa sin migrar botones: `<AccionesPagina>{botones existentes}</AccionesPagina>` →
 *     fila con scroll horizontal en celular (nunca se cortan).
 *   · BarraFiltros: búsqueda siempre visible; los demás filtros en línea en ≥ 768 px y, en
 *     celular/tablet chica, dentro de un botón "Filtros (n)" que abre una hoja inferior.
 *   · GrillaKpis: 2 columnas en celular, `columnas` (2–6) desde lg.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowLeft, Loader2, MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { HojaInferior } from "@/erp2/components/HojaInferior";
import { MenuAcciones } from "@/erp2/components/MenuAcciones";
import { ScrollHorizontal } from "@/erp2/components/ScrollHorizontal";
import { useMediaQuery } from "@/erp2/lib/ui/responsive";

export function EncabezadoPagina({ kicker, titulo, subtitulo, acciones, volver, volverDiscreto = false, className = "" }: {
  kicker?: ReactNode;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acciones?: ReactNode;
  volver?: { href: string; label: string };
  /** `volver` como flecha sola al lado del título (pantallas de uso intensivo: no suma alto). */
  volverDiscreto?: boolean;
  className?: string;
}) {
  return (
    <header className={`flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4 ${className}`}>
      <div className="min-w-0">
        {/* Celular: una sola fila (flecha + título); el kicker y el subtítulo solo en tablet/compu. */}
        {volver && !volverDiscreto ? (
          <Link href={volver.href} className="-ml-1 mb-1.5 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800 max-md:hidden">
            <ArrowLeft className="h-3.5 w-3.5" /> {volver.label}
          </Link>
        ) : null}
        {kicker ? (
          <div className="flex items-center gap-2 max-md:hidden">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--brand)", boxShadow: "0 0 0 3px var(--brand-100)" }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">{kicker}</p>
          </div>
        ) : null}
        {volver ? (
          <div className="mt-1 flex min-w-0 items-center gap-1 max-md:mt-0">
            <span className={volverDiscreto ? "contents" : "contents md:hidden"}><VolverIcono href={volver.href} label={volver.label} /></span>
            <h1 className="min-w-0 text-xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">{titulo}</h1>
          </div>
        ) : (
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere] max-md:mt-0 sm:text-2xl">{titulo}</h1>
        )}
        {subtitulo ? <p className="mt-1 max-w-3xl text-[13px] text-slate-500 max-md:hidden sm:text-sm">{subtitulo}</p> : null}
      </div>
      {acciones ? <div className="min-w-0 sm:shrink-0">{acciones}</div> : null}
    </header>
  );
}

/**
 * "Volver" discreto: solo la flecha, en la línea del título (ej. CRM, Agenda → Comercial). Área
 * táctil de 44 px en celular sin agrandar la línea (márgenes negativos).
 */
export function VolverIcono({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={`Volver a ${label}`} title={`Volver a ${label}`}
      className="-my-2 -ml-2 inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:my-0 lg:h-8 lg:w-8">
      <ArrowLeft className="h-4 w-4" />
    </Link>
  );
}

export type AccionPagina = {
  etiqueta: string;
  icono?: ReactNode;
  onClick?: () => void;
  href?: string;
  /** queda visible en celular (el resto va al menú "⋯") */
  primaria?: boolean;
  deshabilitada?: boolean;
  cargando?: boolean;
  tono?: "normal" | "peligro";
};

const BTN = "inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition disabled:opacity-50 h-11 sm:h-[38px]";
const BTN_PRIMARIO = `${BTN} bg-[var(--brand)] text-white shadow-sm hover:brightness-95`;
const BTN_SECUNDARIO = `${BTN} border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-[var(--brand)] hover:text-[var(--brand)]`;

export function AccionesPagina({ acciones, children }: { acciones?: AccionPagina[]; children?: ReactNode }) {
  const router = useRouter();
  const esMovil = useMediaQuery("(max-width: 639.98px)");

  // Modo "envolver botones existentes": fila con scroll horizontal en celular.
  if (!acciones) {
    return (
      <ScrollHorizontal claseFila="gap-2 items-center" className="sm:overflow-visible">
        {children}
      </ScrollHorizontal>
    );
  }

  const ejecutar = (a: AccionPagina) => (a.href ? router.push(a.href) : a.onClick?.());
  const boton = (a: AccionPagina, extra = "") => {
    const contenido = (
      <>
        {a.cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : a.icono ? <span className="flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{a.icono}</span> : null}
        <span className="truncate">{a.etiqueta}</span>
      </>
    );
    const cls = `${a.primaria ? BTN_PRIMARIO : BTN_SECUNDARIO} ${a.tono === "peligro" ? "text-rose-600" : ""} ${extra}`;
    if (a.href && !a.deshabilitada) return <Link key={a.etiqueta} href={a.href} className={cls}>{contenido}</Link>;
    return <button key={a.etiqueta} type="button" onClick={() => ejecutar(a)} disabled={a.deshabilitada || a.cargando} className={cls}>{contenido}</button>;
  };

  if (!esMovil) return <div className="flex flex-wrap items-center gap-2">{acciones.map((a) => boton(a))}</div>;

  const visibles = acciones.filter((a) => a.primaria);
  const resto = acciones.filter((a) => !a.primaria);
  // Sin primarias: la primera queda visible.
  if (!visibles.length && resto.length) visibles.push(resto.shift()!);
  return (
    <div className="flex items-center gap-2">
      {visibles.map((a) => boton(a, "min-w-0 flex-1"))}
      {resto.length ? (
        <MenuAcciones etiqueta="Más acciones" className={`${BTN_SECUNDARIO} w-11 shrink-0 px-0`}
          items={resto.filter((a) => !a.deshabilitada).map((a) => ({ etiqueta: a.etiqueta, icono: a.icono, onClick: () => ejecutar(a), tono: a.tono === "peligro" ? "peligro" : "normal" }))}>
          <MoreHorizontal className="h-5 w-5" />
        </MenuAcciones>
      ) : null}
    </div>
  );
}

export function BarraFiltros({ busqueda, children, activos = 0, onLimpiar, extra, className = "", plano = false, inicio }: {
  /** sin caja propia (borde/fondo/padding): cuando la barra ya va dentro de una tarjeta */
  plano?: boolean;
  /** algo que va primero y siempre a la vista (ej. el período de los reportes): en la misma
   *  fila en ≥ 768 px; en celular a todo el ancho, arriba del botón "Filtros". Con `inicio`,
   *  "Limpiar filtros" y `extra` se alinean a la derecha de la fila. */
  inicio?: ReactNode;
  /** el buscador (siempre visible) */
  busqueda?: ReactNode;
  /** los filtros (Select, checkboxes, fechas…): en línea en ≥ 768 px; en una hoja en celular */
  children?: ReactNode;
  /** cuántos filtros están aplicados (badge del botón "Filtros") */
  activos?: number;
  onLimpiar?: () => void;
  /** algo que va siempre en la barra, a la derecha (ej. "Columnas") */
  extra?: ReactNode;
  className?: string;
}) {
  const angosta = useMediaQuery("(max-width: 767.98px)");
  const [hoja, setHoja] = useState(false);

  if (!angosta) {
    const limpiar = onLimpiar && activos > 0 ? (
      <button type="button" onClick={onLimpiar} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
        Limpiar filtros
      </button>
    ) : null;
    return (
      <div className={`flex flex-wrap items-center gap-2 ${plano ? "" : `rounded-xl border border-slate-200 bg-white ${inicio ? "p-2" : "p-2.5"} shadow-sm`} ${className}`}>
        {inicio}
        {busqueda ? <div className="min-w-[200px] flex-1">{busqueda}</div> : null}
        {/* Con `inicio` y sin búsqueda, desde lg los filtros se reparten el ancho de la fila
            (sin hueco a la derecha); en tablet quedan a su ancho natural y envuelven. */}
        {inicio && !busqueda ? <div className="contents lg:[&>*]:flex-auto">{children}</div> : children}
        {inicio ? (
          limpiar || extra ? <div className="ml-auto flex shrink-0 items-center gap-2">{limpiar}{extra}</div> : null
        ) : (
          <>{limpiar}{extra}</>
        )}
      </div>
    );
  }

  const fila = (
    <div className={`flex items-center gap-2 ${plano || inicio ? "" : "rounded-xl border border-slate-200 bg-white p-2 shadow-sm"} ${inicio ? "" : className}`}>
      {busqueda ? <div className="min-w-0 flex-1">{busqueda}</div> : <div className="flex-1" />}
      {children ? (
        <button type="button" onClick={() => setHoja(true)} aria-label={`Filtros${activos ? ` (${activos} aplicados)` : ""}`}
          className={`relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${activos ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700"}`}>
          <SlidersHorizontal className="h-4 w-4" />
          <span className="max-[380px]:sr-only">Filtros</span>
          {activos ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[11px] font-bold text-white">{activos}</span> : null}
        </button>
      ) : null}
      {extra}
      {hoja ? (
        <HojaInferior
          titulo="Filtros"
          onClose={() => setHoja(false)}
          pie={
            <>
              {onLimpiar ? (
                <button type="button" onClick={onLimpiar} disabled={!activos}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-40">Limpiar</button>
              ) : null}
              <button type="button" onClick={() => setHoja(false)} className="flex-1 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white">Ver resultados</button>
            </>
          }
        >
          {/* Cada filtro a todo el ancho, uno debajo del otro. */}
          <div className="flex flex-col gap-3 [&>*]:!w-full [&>*]:!min-w-0">{children}</div>
        </HojaInferior>
      ) : null}
    </div>
  );

  if (!inicio) return fila;
  return (
    <div className={`flex flex-col gap-2 ${plano ? "" : "rounded-xl border border-slate-200 bg-white p-2 shadow-sm"} ${className}`}>
      {inicio}
      {busqueda || children || extra ? fila : null}
    </div>
  );
}

export function GrillaKpis({ children, columnas = 4, className = "" }: { children: ReactNode; columnas?: 2 | 3 | 4 | 5 | 6; className?: string }) {
  const lg = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[columnas];
  // Tablet: hasta 4 por fila (5 y 6 pasan a 3 por fila).
  const sm = { 2: "", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-3", 6: "sm:grid-cols-3" }[columnas];
  return <div className={`grid grid-cols-2 gap-2.5 sm:gap-3 ${sm} ${lg} ${className}`}>{children}</div>;
}
