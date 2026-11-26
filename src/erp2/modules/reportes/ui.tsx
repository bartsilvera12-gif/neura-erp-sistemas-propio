"use client";

/**
 * Piezas comunes de las pantallas de reportes: filtros en la URL (rango con atajos +
 * sucursal), encabezado con "← Reportes", números clave, tarjetas, tablas, descargas y la
 * carga de datos (stale-while-revalidate). Todas las pantallas de /reportes se ven iguales.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarDays, Check, ChevronDown, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { HojaInferior } from "@/erp2/components/HojaInferior";
import { useEsMovil, useMediaQuery } from "@/erp2/lib/ui/responsive";
import { apiFetchSWR } from "@/erp2/lib/api/cache-cliente";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { hoyPY } from "@/erp2/lib/fecha/paraguay";
import { Select } from "@/erp2/components/Select";
import { DeltaTexto } from "@/erp2/components/graficos/Graficos";
import { TablaScroll, useVistaTarjetas } from "@/erp2/components/TablaResponsive";
import { ScrollHorizontal } from "@/erp2/components/ScrollHorizontal";
import type { SucursalOpcion } from "@/erp2/modules/reportes/tipos";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";

// ── Rango de fechas ─────────────────────────────────────────────────────────
export type Atajo = "hoy" | "semana" | "mes" | "mes_anterior" | "3m" | "6m" | "12m" | "24m" | "anio" | "todo";
export const ATAJO_LABEL: Record<Atajo, string> = {
  hoy: "Hoy", semana: "Esta semana", mes: "Este mes", mes_anterior: "Mes anterior", "3m": "3 meses", "6m": "6 meses",
  "12m": "12 meses", "24m": "24 meses", anio: "Este año", todo: "Todo",
};
export const ATAJOS_BASE: Atajo[] = ["hoy", "semana", "mes", "mes_anterior", "anio"];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function rangoAtajo(k: Atajo): { desde: string; hasta: string } {
  const hoy = hoyPY();
  const [y, m, dd] = hoy.split("-").map(Number);
  const ini = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm - 1, 1)));
  const fin = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm, 0)));
  switch (k) {
    case "hoy": return { desde: hoy, hasta: hoy };
    case "semana": {
      const d = new Date(Date.UTC(y, m - 1, dd));
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // lunes
      return { desde: ymd(d), hasta: hoy };
    }
    case "mes_anterior": return { desde: ini(y, m - 1), hasta: fin(y, m - 1) };
    case "3m": return { desde: ini(y, m - 2), hasta: hoy };
    case "6m": return { desde: ini(y, m - 5), hasta: hoy };
    case "12m": return { desde: ini(y, m - 11), hasta: hoy };
    case "24m": return { desde: ini(y, m - 23), hasta: hoy };
    case "anio": return { desde: `${y}-01-01`, hasta: hoy };
    case "todo": return { desde: "", hasta: "" };
    default: return { desde: ini(y, m), hasta: hoy };
  }
}

export type Filtros = { desde: string; hasta: string; sucursal: string; atajo: Atajo | null };

/** Filtros guardados en la URL (se pueden compartir y los enlaces del Inicio llegan filtrados). */
export function useFiltrosReporte(defecto: Atajo = "mes", extras: string[] = []) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tieneRango = sp.has("desde") || sp.has("hasta");
  const atajoUrl = sp.get("atajo") as Atajo | null;
  const base = rangoAtajo(atajoUrl ?? defecto);
  const f: Filtros = {
    desde: tieneRango ? sp.get("desde") ?? "" : base.desde,
    hasta: tieneRango ? sp.get("hasta") ?? "" : base.hasta,
    sucursal: sp.get("sucursal") ?? "",
    atajo: tieneRango && !atajoUrl ? null : atajoUrl ?? defecto,
  };
  const extra = Object.fromEntries(extras.map((k) => [k, sp.get(k) ?? ""]));

  const cambiar = useCallback((cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }, [sp, router, pathname]);

  const setAtajo = (k: Atajo) => {
    const r = rangoAtajo(k);
    cambiar({ atajo: k, desde: r.desde || null, hasta: r.hasta || null });
  };
  const setRango = (desde: string, hasta: string) => cambiar({ atajo: null, desde: desde || null, hasta: hasta || null });
  const setSucursal = (s: string) => cambiar({ sucursal: s || null });

  /** Query para la API: desde, hasta, sucursal (+ extras). */
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (f.desde) p.set("desde", f.desde);
    if (f.hasta) p.set("hasta", f.hasta);
    if (f.sucursal) p.set("sucursal", f.sucursal);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.desde, f.hasta, f.sucursal, JSON.stringify(extra)]);

  return { f, extra, query, setAtajo, setRango, setSucursal, cambiar };
}

/** Datos de un reporte (muestra lo último visto al instante y actualiza en segundo plano). */
export function useReporte<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    setCargando(true);
    apiFetchSWR<T>(url, (d) => { setData(d); setError(null); }, { signal: ctrl.signal, fresco: recarga > 0 })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [url, recarga]);
  return { data, error, cargando, recargar: () => setRecarga((n) => n + 1) };
}

// ── Encabezado y filtros ────────────────────────────────────────────────────
export function EncabezadoReporte({ kicker, titulo, subtitulo, volver = { href: "/reportes", label: "Reportes" }, children }: {
  kicker: string; titulo: ReactNode; subtitulo?: ReactNode; volver?: { href: string; label: string } | null; children?: ReactNode;
}) {
  return (
    // Responsive: en celular el título baja a 20 px y las acciones (Excel / PDF) van debajo.
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {/* Celular: una sola fila (flecha + título); kicker y subtítulo solo en tablet/compu. */}
        {volver ? (
          <Link href={volver.href} className="-ml-1.5 mb-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800 max-md:hidden">
            <ArrowLeft className="h-3.5 w-3.5" /> {volver.label}
          </Link>
        ) : null}
        <div className="flex items-center gap-2 max-md:hidden">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--brand)", boxShadow: "0 0 0 3px var(--brand-100)" }} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">{kicker}</p>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1 max-md:mt-0">
          {volver ? (
            <Link href={volver.href} aria-label={`Volver a ${volver.label}`} title={`Volver a ${volver.label}`}
              className="-my-2 -ml-2 inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:hidden">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          ) : null}
          <h1 className="min-w-0 text-xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">{titulo}</h1>
        </div>
        {subtitulo ? <p className="mt-1 max-w-3xl text-[13px] text-slate-500 max-md:hidden sm:text-sm">{subtitulo}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>button]:min-h-11 max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center">{children}</div> : null}
    </div>
  );
}


/**
 * Barra de filtros de los reportes: una sola fila (con wrap) en ≥ 640 px — el período en un
 * botón ("Este mes · 1 – 27 oct 2026") + la sucursal como chip + extras, y a la derecha
 * "Limpiar filtros" / "Actualizando…". En celular, todo a lo ancho, uno debajo del otro.
 */
export function FiltrosReporte({ filtros, atajos = ATAJOS_BASE, sucursales, cargando, children, sinFechas = false, etiquetaFechas }: {
  filtros: ReturnType<typeof useFiltrosReporte>;
  atajos?: Atajo[];
  sucursales?: SucursalOpcion[] | null;
  cargando?: boolean;
  children?: ReactNode;
  sinFechas?: boolean;
  /** ej. "Emitidas" (CxC / CxP filtran por fecha de emisión) */
  etiquetaFechas?: string;
}) {
  const { f, setAtajo, setRango, setSucursal } = filtros;
  const opcionesAtajo = useMemo(() => atajos.map((k): [string, string] => [k, ATAJO_LABEL[k]]), [atajos]);
  const hayFiltro = !!f.sucursal && !!sucursales && sucursales.length > 1;
  return (
    // Con 1–2 controles la barra abraza su contenido (sin una franja vacía a la derecha).
    <section aria-label="Filtros del reporte" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:w-fit sm:max-w-full sm:flex-row sm:flex-wrap sm:items-center">
      {!sinFechas ? (
        <SelectorPeriodo atajos={opcionesAtajo} atajo={f.atajo} onAtajo={(k) => setAtajo(k as Atajo)}
          desde={f.desde} hasta={f.hasta} onRango={setRango} maxHasta={hoyPY()} etiqueta={etiquetaFechas?.replace(/:\s*$/, "")} />
      ) : null}
      {sucursales && sucursales.length > 1 ? (
        <Select chip prefijo="Sucursal" textoVacio="Todas" value={f.sucursal} onChange={setSucursal} minWidth={200} etiqueta="Sucursal"
          options={[["", "Todas las sucursales"], ...sucursales.map((s): [string, string] => [s.id, s.nombre])]} />
      ) : sucursales && sucursales.length === 1 ? (
        <span className="inline-flex h-[38px] items-center rounded-xl bg-slate-50 px-3 text-[13px] text-slate-500 max-sm:h-11"><span className="text-slate-400">Sucursal:&nbsp;</span><span className="font-semibold text-slate-600">{sucursales[0].nombre}</span></span>
      ) : null}
      {children}
      {hayFiltro || cargando ? (
        <div className="flex items-center gap-2 sm:ml-auto max-sm:justify-between">
          {cargando ? <span className="inline-flex items-center gap-1 px-1 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> Actualizando…</span> : null}
          {hayFiltro ? (
            <button type="button" onClick={() => setSucursal("")} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-[var(--brand)] max-sm:ml-auto max-sm:min-h-11 max-sm:text-[13px]">
              Limpiar filtros
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Período con estado propio de la página (Ventas del período, Productos vendidos): el mismo
 * botón de período que FiltrosReporte. Misma API de siempre (onAtajo / onDesde / onHasta).
 */
export function RangoFechasLocal({ atajos, atajo, onAtajo, desde, hasta, onDesde, onHasta }: {
  atajos: [string, string][];
  atajo: string | null;
  onAtajo: (k: string) => void;
  desde: string;
  hasta: string;
  onDesde: (v: string) => void;
  onHasta: (v: string) => void;
}) {
  return (
    <SelectorPeriodo atajos={atajos} atajo={atajo} onAtajo={onAtajo} desde={desde} hasta={hasta}
      onRango={(d, h) => { if (d !== desde) onDesde(d); if (h !== hasta) onHasta(h); }} />
  );
}

// ── Selector de período ─────────────────────────────────────────────────────
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const AYER = "__ayer";

function ayerPY() {
  const [y, m, d] = hoyPY().split("-").map(Number);
  return ymd(new Date(Date.UTC(y, m - 1, d - 1)));
}

/** "1 – 27 oct 2026", "28 sep – 27 oct 2026", "27 oct 2026", "1 dic 2025 – 27 oct 2026". */
export function textoRango(desde: string, hasta: string) {
  const p = (s: string) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });
  const f = (s: string) => { const x = p(s); return `${x.d} ${MESES_CORTOS[x.m - 1]} ${x.y}`; };
  if (!desde && !hasta) return "";
  if (!desde) return `hasta ${f(hasta)}`;
  if (!hasta) return `desde ${f(desde)}`;
  if (desde === hasta) return f(desde);
  const a = p(desde), b = p(hasta);
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MESES_CORTOS[b.m - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MESES_CORTOS[a.m - 1]} – ${b.d} ${MESES_CORTOS[b.m - 1]} ${b.y}`;
  return `${f(desde)} – ${f(hasta)}`;
}

/**
 * Un solo botón para el período ("📅 Este mes · 1 – 27 oct 2026"). Al tocarlo abre un popover
 * (en celular, hoja inferior) con los atajos a la izquierda y Desde / Hasta + "Aplicar".
 * Los atajos se aplican al toque; el rango personalizado, con "Aplicar". Si la lista trae "Hoy",
 * suma "Ayer" (se aplica como rango de un día). Escape cierra (capa `data-capa-modal`).
 */
export function SelectorPeriodo({ atajos, atajo, onAtajo, desde, hasta, onRango, maxHasta, etiqueta }: {
  atajos: [string, string][];
  atajo: string | null;
  onAtajo: (k: string) => void;
  desde: string;
  hasta: string;
  onRango: (desde: string, hasta: string) => void;
  /** tope del "Hasta" (ej. hoy) */
  maxHasta?: string;
  /** antes del período, ej. "Emitidas" */
  etiqueta?: string;
}) {
  const esMovil = useEsMovil();
  const sinAnimacion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [abierto, setAbierto] = useState(false);
  const [bDesde, setBDesde] = useState(desde);
  const [bHasta, setBHasta] = useState(hasta);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const ayer = ayerPY();
  const lista = useMemo<[string, string][]>(() => {
    const i = atajos.findIndex(([k]) => k === "hoy");
    if (i < 0 || atajos.some(([k]) => k === "ayer")) return atajos;
    return [...atajos.slice(0, i + 1), [AYER, "Ayer"], ...atajos.slice(i + 1)];
  }, [atajos]);
  const activo = atajo ?? (desde && desde === ayer && hasta === ayer && lista.some(([k]) => k === AYER) ? AYER : null);
  const nombreAtajo = activo ? lista.find(([k]) => k === activo)?.[1] ?? null : null;
  const rango = textoRango(desde, hasta);
  const ANCHO = 452;

  const cerrar = useCallback((devolverFoco = true) => {
    setAbierto(false);
    if (devolverFoco) window.setTimeout(() => boton.current?.focus(), 0);
  }, []);
  function abrir() {
    setBDesde(desde);
    setBHasta(hasta);
    setAbierto(true);
  }
  function elegirAtajo(k: string) {
    if (k === AYER) onRango(ayer, ayer);
    else onAtajo(k);
    cerrar();
  }
  const valido = !!bDesde && !!bHasta && bDesde <= bHasta;
  function aplicar() {
    if (!valido) return;
    onRango(bDesde, bHasta);
    cerrar();
  }

  // Escritorio: pegado al botón, sin salirse de la pantalla; se recalcula al scrollear.
  const ubicar = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const margen = 8;
    const alto = 330;
    const abajo = window.innerHeight - r.bottom - margen;
    const arriba = r.top - margen;
    const left = Math.max(margen, Math.min(r.left, window.innerWidth - ANCHO - margen));
    if (abajo >= alto || abajo >= arriba) setPos({ left, top: r.bottom + 6, maxH: Math.max(200, abajo - 6) });
    else setPos({ left, bottom: window.innerHeight - r.top + 6, maxH: Math.max(200, arriba - 6) });
  }, []);
  useLayoutEffect(() => {
    if (!abierto || esMovil) return;
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => {
      window.removeEventListener("resize", ubicar);
      window.removeEventListener("scroll", ubicar, true);
    };
  }, [abierto, esMovil, ubicar]);

  // Escritorio: click afuera y Escape (sólo si es la capa de arriba: el calendario de
  // Desde/Hasta también es una capa y se cierra primero).
  useEffect(() => {
    if (!abierto || esMovil) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest?.("[data-capa-modal]")) return;
      setAbierto(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const capas = document.querySelectorAll("[data-capa-modal]");
      if (capas.length && capas[capas.length - 1] !== panel.current) return;
      e.preventDefault();
      cerrar();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [abierto, esMovil, cerrar]);

  // Al abrir, foco en el atajo elegido (o el primero).
  useEffect(() => {
    if (!abierto || (!pos && !esMovil)) return;
    const t = window.setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>('[data-atajo][aria-pressed="true"]') ?? panel.current?.querySelector<HTMLElement>("[data-atajo]");
      el?.focus({ preventScroll: true });
    }, esMovil ? 60 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, pos != null, esMovil]);

  const listaAtajos = (
    <div role="group" aria-label="Atajos" className={esMovil ? "grid grid-cols-2 gap-2" : "flex w-[148px] shrink-0 flex-col gap-0.5 border-r border-slate-100 pr-2"}>
      {lista.map(([k, l]) => {
        const sel = activo === k;
        return (
          <button key={k} type="button" data-atajo="" aria-pressed={sel} onClick={() => elegirAtajo(k)}
            className={`flex items-center justify-between gap-2 rounded-lg text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${esMovil ? `min-h-11 border px-3 text-sm ${sel ? "border-transparent" : "border-slate-200"}` : "h-8 px-2.5 text-[13px]"} ${sel ? "bg-[var(--brand-50)] font-semibold text-[var(--brand)]" : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"}`}>
            <span className="truncate">{l}</span>
            {sel ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );

  const rangoPersonalizado = (
    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Rango personalizado</p>
      <div className={esMovil ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2.5"}>
        <div className="min-w-0">
          <p id={`${id}-d`} className="mb-1 text-xs font-medium text-slate-500">Desde</p>
          <SelectorFecha compacto block etiqueta="Desde" value={bDesde} max={bHasta || maxHasta || undefined} onChange={setBDesde}
            claseBoton="h-[38px] rounded-xl px-3 text-[13px] text-slate-800 max-sm:h-11 max-sm:text-sm" />
        </div>
        <div className="min-w-0">
          <p id={`${id}-h`} className="mb-1 text-xs font-medium text-slate-500">Hasta</p>
          <SelectorFecha compacto block etiqueta="Hasta" value={bHasta} min={bDesde || undefined} max={maxHasta} onChange={setBHasta}
            claseBoton="h-[38px] rounded-xl px-3 text-[13px] text-slate-800 max-sm:h-11 max-sm:text-sm" />
        </div>
      </div>
      {!esMovil ? (
        <div className="mt-auto flex items-center justify-end gap-1.5 pt-1">
          <button type="button" onClick={() => cerrar()} className="h-8 rounded-lg px-3 text-[13px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-[var(--brand)]">Cancelar</button>
          <button type="button" onClick={aplicar} disabled={!valido} className="h-8 rounded-lg bg-[var(--brand)] px-4 text-[13px] font-semibold text-white transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-40">Aplicar</button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div ref={ref} className="relative min-w-0 max-sm:w-full">
      <button ref={boton} type="button" onClick={() => (abierto ? cerrar(false) : abrir())}
        aria-haspopup="dialog" aria-expanded={abierto}
        aria-label={`Período${etiqueta ? ` (${etiqueta.toLowerCase()})` : ""}: ${[nombreAtajo, rango].filter(Boolean).join(", ") || "sin límite"}`}
        className="flex h-[38px] w-full max-w-full items-center gap-2 whitespace-nowrap rounded-xl border bg-white pl-3 pr-2.5 text-[13px] text-slate-700 outline-none transition hover:border-slate-300 hover:bg-slate-50 focus-visible:shadow-[0_0_0_4px_var(--brand-100)] max-sm:h-11 max-sm:text-sm"
        style={{ borderColor: abierto ? "var(--brand)" : "#e2e8f0", boxShadow: abierto ? "0 0 0 4px var(--brand-100)" : undefined }}>
        <CalendarDays className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">
          {etiqueta ? <span className="text-slate-400">{etiqueta}: </span> : null}
          {nombreAtajo ? <span className="font-semibold text-slate-800">{nombreAtajo}</span> : null}
          {nombreAtajo && rango ? <span className="text-slate-300"> · </span> : null}
          {rango ? <span className={`tabular-nums ${nombreAtajo ? "text-slate-500" : "font-semibold text-slate-800"}`}>{rango}</span> : null}
          {!nombreAtajo && !rango ? <span className="text-slate-400">Elegí un período</span> : null}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${abierto ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {abierto && esMovil ? (
        <HojaInferior titulo="Período" onClose={() => cerrar()} panelRef={panel}
          pie={
            <>
              <button type="button" onClick={() => cerrar()} className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700">Cancelar</button>
              <button type="button" onClick={aplicar} disabled={!valido} className="min-h-11 flex-1 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white disabled:opacity-40">Aplicar rango</button>
            </>
          }>
          <div className="flex flex-col gap-4">
            {listaAtajos}
            {rangoPersonalizado}
          </div>
        </HojaInferior>
      ) : null}

      {abierto && !esMovil && pos && typeof document !== "undefined" ? createPortal(
        <div ref={panel} data-capa-modal="" role="dialog" aria-label="Elegir período"
          className="fixed z-[200] flex gap-3 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-2.5 shadow-[0_12px_32px_-8px_rgba(2,48,71,0.25)]"
          style={{
            left: pos.left, width: ANCHO, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH,
            transformOrigin: pos.top != null ? "top" : "bottom", animation: sinAnimacion ? undefined : "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)",
          }}>
          {listaAtajos}
          {rangoPersonalizado}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

// ── Descargas ───────────────────────────────────────────────────────────────
export function Descargas({ excel, pdf, deshabilitado }: { excel?: string; pdf?: string; deshabilitado?: boolean }) {
  const [bajando, setBajando] = useState<"" | "xlsx" | "pdf">("");
  const [error, setError] = useState<string | null>(null);
  const bajar = async (tipo: "xlsx" | "pdf", url: string) => {
    setBajando(tipo);
    setError(null);
    try {
      await descargarArchivo(url, `reporte.${tipo}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBajando("");
    }
  };
  return (
    <>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
      {excel ? (
        <button type="button" onClick={() => bajar("xlsx", excel)} disabled={!!bajando || deshabilitado}
          className="inline-flex h-[38px] items-center gap-2 rounded-xl border border-[var(--brand-100)] bg-white px-4 text-sm font-semibold text-[var(--brand)] transition hover:bg-[var(--brand-50)] disabled:opacity-50">
          {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
        </button>
      ) : null}
      {pdf ? (
        <button type="button" onClick={() => bajar("pdf", pdf)} disabled={!!bajando || deshabilitado}
          className="inline-flex h-[38px] items-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50">
          {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF
        </button>
      ) : null}
    </>
  );
}

// ── Números clave, tarjetas, tablas ─────────────────────────────────────────
export function Kpi({ label, valor, hint, delta, acento, tono, href, onClick }: {
  label: string;
  valor: ReactNode;
  hint?: ReactNode;
  /** variación contra el período anterior */
  delta?: { actual: number; anterior: number; invertir?: boolean; texto?: string } | null;
  acento?: boolean;
  tono?: "bueno" | "malo" | "alerta";
  href?: string;
  onClick?: () => void;
}) {
  const color = tono === "bueno" ? "text-emerald-700" : tono === "malo" ? "text-rose-600" : tono === "alerta" ? "text-amber-600" : acento ? "text-[var(--brand)]" : "text-slate-900";
  const cuerpo = (
    <>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      {/* Celular: el monto nunca se corta (si no entra, "Gs." y la cifra van en dos renglones) y
          las notas usan hasta 2 renglones; desde sm, un renglón con "…". */}
      <p className={`mt-1 text-[15px] font-semibold leading-snug tabular-nums [overflow-wrap:anywhere] sm:truncate sm:text-lg lg:text-base xl:text-lg 2xl:text-xl ${color}`} title={typeof valor === "string" ? valor : undefined}>{valor}</p>
      {delta ? (
        <p className="mt-0.5 text-xs max-sm:line-clamp-2 sm:truncate"><DeltaTexto actual={delta.actual} anterior={delta.anterior} invertir={delta.invertir} />{delta.texto ? <span className="text-slate-400"> {delta.texto}</span> : null}</p>
      ) : null}
      {hint ? <p className="mt-0.5 text-xs text-slate-400 max-sm:line-clamp-2 max-sm:text-[11.5px] max-sm:leading-snug sm:truncate">{hint}</p> : null}
    </>
  );
  const clase = `block min-w-0 rounded-2xl border bg-white p-3 text-left shadow-sm transition sm:p-4 ${acento ? "border-[var(--brand-100)] bg-[var(--brand-50)]" : "border-slate-200"} ${href || onClick ? "hover:-translate-y-0.5 hover:shadow-md" : ""}`;
  if (href) return <Link href={href} className={clase}>{cuerpo}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={`${clase} w-full`}>{cuerpo}</button>;
  return <div className={clase}>{cuerpo}</div>;
}

/**
 * Grilla de números clave de los reportes: 2 por fila en celular (si sobra uno impar, ocupa el
 * renglón entero), 3 en tablet cuando son 5 y todos en fila desde lg. (No usa GrillaKpis porque
 * con 4 por fila en tablet los montos "Gs. 1.234.567.890" no entran.)
 */
export function FilaKpis({ n, children }: { n: 3 | 4 | 5; children: ReactNode }) {
  const cls = {
    3: "sm:grid-cols-3 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2",
    4: "lg:grid-cols-4",
    5: "md:grid-cols-3 lg:grid-cols-5 max-md:[&>*:last-child:nth-child(odd)]:col-span-2",
  }[n];
  return <div className={`grid grid-cols-2 gap-2.5 sm:gap-3 ${cls}`}>{children}</div>;
}

export function Tarjeta({ titulo, sub, extra, children, className = "" }: { titulo: ReactNode; sub?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2.5 sm:mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="block h-5 w-1 shrink-0 rounded-full bg-[var(--brand)]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{titulo}</h2>
          </div>
          {sub ? <p className="mt-1 pl-3.5 text-xs text-slate-400">{sub}</p> : null}
        </div>
        {/* Celular: leyendas, segmentos y filtros del encabezado bajan a un renglón propio. */}
        {extra ? <div className="min-w-0 max-sm:w-full">{extra}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * `Tarjeta` que en el celular arranca plegada (solo el título): los resúmenes secundarios de un
 * reporte no empujan lo importante hacia abajo. En tablet y escritorio es una `Tarjeta` común.
 */
export function TarjetaPlegable({ titulo, sub, extra, children, className = "" }: { titulo: ReactNode; sub?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  const angosta = useVistaTarjetas();
  if (!angosta) return <Tarjeta titulo={titulo} sub={sub} extra={extra} className={className}>{children}</Tarjeta>;
  return (
    <details className={`group min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="block h-5 w-1 shrink-0 rounded-full bg-[var(--brand)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{titulo}</span>
        </span>
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 px-3.5 pb-3.5">
        {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
        {extra ? <div className="min-w-0">{extra}</div> : null}
        {children}
      </div>
    </details>
  );
}

/** Clases de celda de `Tabla`, para que una `TablaTarjetas` (listas que se abren) se vea igual en escritorio. */
export const TH_REPORTE = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-slate-500";
export const TD_REPORTE = "whitespace-nowrap px-3 py-2.5";
/** Envoltorio de una `TablaTarjetas` dentro de `Tarjeta`: en < 768 px las tarjetas van de borde a borde. */
export const SANGRIA_TARJETAS = "max-sm:-mx-3.5 max-md:border-t max-md:border-slate-100 sm:max-md:-mx-5";

export function Tabla({ cols, filas, der = [], pie, onFila, vacio = "Sin datos.", minW }: {
  cols: ReactNode[];
  filas: { key: string; celdas: ReactNode[]; tenue?: boolean; titulo?: string }[];
  der?: number[];
  pie?: ReactNode[];
  onFila?: (key: string) => void;
  vacio?: string;
  minW?: number;
}) {
  if (!filas.length) return <p className="py-8 text-center text-sm text-slate-400">{vacio}</p>;
  return (
    // Responsive: tabla ancha → scroll horizontal INTERNO (la página nunca), 1.ª columna fija y
    // sombra que indica que hay más (TablaScroll).
    <TablaScroll primeraFija>
      <table className="w-full text-left text-sm" style={minW ? { minWidth: minW } : undefined}>
        <thead>
          <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
            {cols.map((c, i) => (
              <th key={i} className={`whitespace-nowrap px-3 py-2.5 ${i === 0 ? "rounded-l-lg" : ""} ${i === cols.length - 1 ? "rounded-r-lg" : ""} ${der.includes(i) ? "text-right" : ""}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            // Filas que se tocan: ≥ 44 px en celular y el hover pinta también la 1.ª columna fija.
            <tr key={f.key} onClick={onFila ? () => onFila(f.key) : undefined} title={f.titulo}
              className={`border-b border-slate-100 last:border-0 ${onFila ? "cursor-pointer transition-colors hover:bg-slate-50 hover:[--tabla-fondo:var(--color-slate-50)] max-sm:[&>td]:py-3" : ""} ${f.tenue ? "opacity-60" : ""}`}>
              {f.celdas.map((c, i) => (
                <td key={i} className={`whitespace-nowrap px-3 py-2.5 ${der.includes(i) ? "text-right tabular-nums" : ""} ${i === 0 ? "text-slate-800" : "text-slate-600"}`}>
                  {/* Celular: la 1.ª columna (fija) no pasa del 42 % del ancho; nombres largos en 2 renglones. */}
                  {i === 0 ? <div className="max-sm:w-max max-sm:max-w-[42vw] max-sm:whitespace-normal max-sm:break-words max-sm:leading-snug">{c}</div> : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {pie ? (
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
              {pie.map((c, i) => <td key={i} className={`whitespace-nowrap px-3 py-2.5 ${der.includes(i) ? "text-right tabular-nums" : ""}`}>{c}</td>)}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </TablaScroll>
  );
}

export function EstadoCarga({ error, vacio }: { error?: string | null; vacio?: boolean }) {
  if (error) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">No se pudo cargar el reporte: {error}</div>;
  if (vacio) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" />
    </div>
  );
}

export function Nota({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-slate-400">{children}</p>;
}

/** Botón-pestaña chico (vista: por proveedor / por documento, etc.). */
export function Segmentos<T extends string>({ valor, opciones, onChange, barra = false }: { valor: T; opciones: [T, string][]; onChange: (v: T) => void; /** 38 px de alto, como los chips de la barra de filtros */ barra?: boolean }) {
  return (
    // Responsive: si no entran, scroll horizontal interno (nunca se cortan ni saltan de línea).
    <ScrollHorizontal className="w-fit max-w-full rounded-xl bg-slate-100 p-1" claseFila="gap-0" dependencias={[valor]}>
      {opciones.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={valor === v} data-activo={valor === v ? "true" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${barra ? "h-[30px] max-sm:h-auto" : "py-1"} max-sm:min-h-11 max-sm:px-3.5 max-sm:text-[13px] ${valor === v ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
      ))}
    </ScrollHorizontal>
  );
}
