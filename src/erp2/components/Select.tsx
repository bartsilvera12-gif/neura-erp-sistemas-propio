"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { filtrar, normalizar } from "@/erp2/lib/busqueda";
import { clienteConfig } from "@/erp2/cliente.config";
import { HojaInferior } from "@/erp2/components/HojaInferior";
import { useEsMovil } from "@/erp2/lib/ui/responsive";

const BRAND = clienteConfig.color;

/**
 * Dropdown elegante y animado (estilo React Bits): no es el <select> nativo, sino un
 * listbox propio con apertura suave, hover y check en el elegido. Cierra con Escape o
 * click afuera.
 * La lista se monta en <body> con position: fixed (como MenuAcciones): nunca queda cortada
 * dentro de un modal con scroll ni de una tabla; si abajo no entra, se abre hacia arriba.
 * En celular (< 640 px) la lista se abre como HOJA INFERIOR a todo el ancho, con opciones de
 * 48 px (cómodas al dedo) y nunca se sale de la pantalla; `etiqueta` es su título.
 */
export function Select({
  value,
  onChange,
  options,
  minWidth,
  block = false,
  disabled = false,
  compacto = false,
  chico = false,
  className = "",
  etiqueta,
  chip = false,
  prefijo,
  textoVacio,
  buscador,
}: {
  /** campo "Buscar…" arriba de la lista; por defecto, solo con más de 8 opciones */
  buscador?: boolean;
  /** "chip" de barra de filtros (38 px, texto 13 px, "Prefijo: valor"); se resalta con el color
   *  de marca cuando el valor no es la primera opción ("Todos…"). Ver `prefijo` / `textoVacio`. */
  chip?: boolean;
  /** con `chip`: texto antes del valor (ej. "Cajero" → "Cajero: Todos") */
  prefijo?: string;
  /** con `chip`: qué mostrar cuando está en la primera opción (ej. "Todos" en vez de "Todos los cajeros") */
  textoVacio?: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  /** ancho mínimo (selects de barra/toolbar) */
  minWidth?: number;
  /** ocupa todo el ancho (campos de formulario) */
  block?: boolean;
  /** gris y sin abrir (ej. subcategoría sin categoría elegida) */
  disabled?: boolean;
  /** mismo tamaño que un input de formulario compacto (rounded-lg, px-3 py-2, texto normal) */
  compacto?: boolean;
  /** aún más chico (36 px, texto 13 px; 44 px en pantallas táctiles): selects dentro de tarjetas */
  chico?: boolean;
  className?: string;
  /** título de la hoja inferior en celular (ej. "Categoría"); también aria-label del botón */
  etiqueta?: string;
}) {
  const esMovil = useEsMovil();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // opción resaltada para el teclado
  const ref = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const current = options.find((o) => o[0] === value) ?? options[0];
  const boton = useRef<HTMLButtonElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  // Listas largas: buscador arriba (búsqueda inteligente: tildes, errores de tipeo, plural).
  const conBuscador = buscador ?? options.length > 8;
  const [q, setQ] = useState("");
  const visibles = useMemo(
    () => (conBuscador && q.trim() ? filtrar(options, q, (o) => ({ principal: o[1] })) : options),
    [conBuscador, q, options],
  );
  const abiertoConTecla = useRef(false);

  /** Abre la lista (con `texto` si se abrió escribiendo) y resalta la elegida o la 1.ª coincidencia. */
  function abrir(texto = "") {
    abiertoConTecla.current = !!texto;
    setQ(texto);
    if (texto) {
      setHi(0);
    } else {
      setHi(Math.max(0, options.findIndex((o) => o[0] === value)));
    }
    setOpen(true);
  }
  function cerrar(volverFoco = false) {
    setOpen(false);
    setQ("");
    if (volverFoco) boton.current?.focus();
  }
  function elegir(v: string) {
    onChange(v);
    cerrar(true);
  }

  // Foco al buscador al abrir (en celular solo si se abrió escribiendo, para no tapar con el teclado).
  useEffect(() => {
    if (!open || !conBuscador) return;
    if (esMovil && !abiertoConTecla.current) return;
    const t = window.setTimeout(() => campo.current?.focus(), esMovil ? 60 : 0);
    return () => window.clearTimeout(t);
  }, [open, conBuscador, esMovil]);

  // La opción resaltada con el teclado siempre a la vista.
  useEffect(() => {
    if (!open || hi < 0) return;
    lista.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || lista.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Posición de la lista pegada al botón; se recalcula al scrollear o cambiar el tamaño.
  const ubicar = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const margen = 8;
    const abajo = window.innerHeight - r.bottom - margen;
    const arriba = r.top - margen;
    const alto = Math.min(320, options.length * 38 + 10 + (conBuscador ? 46 : 0));
    if (abajo >= Math.min(alto, 180) || abajo >= arriba) {
      setPos({ left: r.left, width: r.width, top: r.bottom + 6, maxH: Math.max(120, abajo - 6) });
    } else {
      setPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6, maxH: Math.max(120, arriba - 6) });
    }
  }, [options.length, conBuscador]);
  useLayoutEffect(() => {
    if (!open || esMovil) return;
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => {
      window.removeEventListener("resize", ubicar);
      window.removeEventListener("scroll", ubicar, true);
    };
  }, [open, ubicar, esMovil]);

  // Al abrir, la opción elegida queda a la vista (listas largas como horarios).
  useEffect(() => {
    if (!open || (!pos && !esMovil)) return;
    const ver = () => lista.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
    // En celular la hoja (portal de CapaModal) se monta un render después.
    if (esMovil) { const t = window.setTimeout(ver, 40); return () => window.clearTimeout(t); }
    ver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos != null, esMovil]);

  // Navegación por teclado (combobox): ↑/↓ mueven, Enter elige, Esc cierra.
  function mover(e: React.KeyboardEvent) {
    e.preventDefault();
    const n = visibles.length;
    if (!n) return;
    setHi((h) => (e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n));
  }
  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) { e.preventDefault(); abrir(); return; }
      mover(e);
    } else if (e.key === "Enter" || e.key === " ") {
      if (open && hi >= 0 && visibles[hi]) { e.preventDefault(); elegir(visibles[hi][0]); }
      // si está cerrado, el click nativo del botón lo abre
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); e.stopPropagation(); cerrar(); }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !disabled) {
      // Escribir con el select enfocado: con buscador lo abre filtrando; sin él, salta a la
      // primera opción que empieza con esa letra.
      if (conBuscador) {
        e.preventDefault();
        if (!open) abrir(e.key);
        else { setQ((x) => x + e.key); setHi(0); campo.current?.focus(); }
      } else {
        const l = normalizar(e.key);
        const i = options.findIndex((o) => normalizar(o[1]).startsWith(l));
        if (i >= 0) { e.preventDefault(); if (!open) setOpen(true); setHi(i); }
      }
    }
  }
  function onBuscarKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") mover(e);
    else if (e.key === "Enter") {
      e.preventDefault();
      if (visibles[hi]) elegir(visibles[hi][0]);
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation(); cerrar(true);
    } else if (e.key === "Tab") {
      cerrar(true);
    }
  }

  /** Campo "Buscar…" arriba de la lista (fijo al scrollear). */
  function campoBuscar(movil: boolean) {
    if (!conBuscador) return null;
    return (
      <div className={`sticky top-0 z-[1] bg-white ${movil ? "px-2 pb-1 pt-2" : "p-1 pb-1.5"}`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={campo}
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={onBuscarKey}
            placeholder="Buscar…"
            aria-label={etiqueta ? `Buscar ${etiqueta.toLowerCase()}` : "Buscar"}
            autoComplete="off"
            spellCheck={false}
            className={`w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2.5 text-slate-800 outline-none placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white ${movil ? "h-11 text-base" : "h-9 text-sm"}`}
          />
        </div>
      </div>
    );
  }
  const sinResultados = conBuscador && !visibles.length
    ? <p className="px-3 py-3 text-center text-sm text-slate-400">Sin resultados</p>
    : null;

  // Chip: activo = no está en la primera opción (la de "Todos…").
  const chipActivo = chip && value !== (options[0]?.[0] ?? "");
  const chipTexto = chip ? (chipActivo ? current?.[1] : textoVacio ?? current?.[1]) : null;
  const bordeCerrado = chipActivo ? "color-mix(in srgb, var(--brand) 38%, white)" : "#e2e8f0";

  if (chip) {
    return (
      <div ref={ref} className={`relative ${block ? "w-full" : ""} ${className}`}>
        <button
          type="button"
          disabled={disabled}
          ref={boton}
          onClick={() => (open ? cerrar() : abrir())}
          onKeyDown={onTriggerKey}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={etiqueta ? `${etiqueta}: ${current?.[1] ?? ""}` : undefined}
          className={`flex h-[38px] w-full max-w-full items-center justify-between gap-1.5 whitespace-nowrap rounded-xl border pl-3 pr-2.5 text-[13px] outline-none transition max-sm:h-11 max-sm:text-sm focus-visible:shadow-[0_0_0_4px_var(--brand-100)] disabled:cursor-not-allowed disabled:opacity-50 ${chipActivo ? "bg-[var(--brand-50)] text-[var(--brand)]" : "bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}
          style={{ borderColor: open ? BRAND : bordeCerrado, boxShadow: open ? `0 0 0 4px var(--brand-100)` : undefined }}
        >
          <span className="min-w-0 truncate">
            {prefijo ? <span className={chipActivo ? "opacity-75" : "text-slate-400"}>{prefijo}: </span> : null}
            <span className="font-semibold">{chipTexto}</span>
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${chipActivo ? "" : "text-slate-400"} ${open ? "rotate-180" : ""}`} />
        </button>
        {listas()}
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${block ? "w-full" : ""} ${className}`} style={minWidth ? { minWidth } : undefined}>
      <button
        type="button"
        disabled={disabled}
        ref={boton}
          onClick={() => (open ? cerrar() : abrir())}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={etiqueta}
        className={`flex w-full items-center justify-between gap-2 border bg-white outline-none max-sm:min-h-11 ${chico ? "h-9 rounded-lg px-2.5 text-[13px] text-slate-800 [@media(pointer:coarse)]:h-11" : compacto ? "rounded-lg px-3 py-2 text-sm text-slate-800" : "rounded-xl py-2.5 pl-3.5 pr-3 text-sm font-medium text-slate-600"} transition hover:border-slate-300 focus:border-[var(--brand)] focus:shadow-[0_0_0_4px_var(--brand-100)] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200`}
        style={{ borderColor: open ? BRAND : "#e2e8f0", boxShadow: open ? `0 0 0 4px var(--brand-100)` : undefined }}
      >
        <span className="truncate">{current?.[1]}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {listas()}
    </div>
  );

  /** Lista de opciones: hoja inferior en celular, popover portaleado en escritorio. */
  function listas() {
    return (
    <>
      {open && !disabled && esMovil ? (
        <HojaInferior titulo={etiqueta ?? "Elegí una opción"} onClose={() => cerrar()} z="z-[200]" sinPadding panelRef={lista}>
          {campoBuscar(true)}
          <div role="listbox" aria-label={etiqueta} className="p-2">
            {visibles.map(([v, label], idx) => {
              const sel = v === value;
              const activo = conBuscador && q.trim() !== "" && idx === hi;
              return (
                <button key={v} type="button" role="option" aria-selected={sel} data-idx={idx}
                  onClick={() => elegir(v)}
                  className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3.5 text-left text-[15px] transition-colors active:bg-slate-100 ${sel ? "font-semibold" : "text-slate-700"}`}
                  style={sel ? { backgroundColor: "var(--brand-50)", color: BRAND } : activo ? { backgroundColor: "#f1f5f9" } : undefined}>
                  <span className="min-w-0 break-words py-2">{label}</span>
                  {sel ? <Check className="h-5 w-5 shrink-0" /> : null}
                </button>
              );
            })}
            {sinResultados}
          </div>
        </HojaInferior>
      ) : null}

      {open && !disabled && !esMovil && pos && typeof document !== "undefined" ? createPortal(
        <div
          ref={lista}
          className={`fixed z-[200] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_-8px_rgba(2,48,71,0.25)] ${conBuscador ? "" : "p-1"}`}
          style={{
            // Si la lista es más ancha que el botón (chips), no se sale por la derecha.
            left: Math.max(8, Math.min(pos.left, window.innerWidth - Math.max(pos.width, minWidth ?? 0, conBuscador ? 220 : 0) - 8)), width: Math.max(pos.width, minWidth ?? 0, conBuscador ? 220 : 0), top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH,
            transformOrigin: pos.top != null ? "top" : "bottom", animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {campoBuscar(false)}
          <div role="listbox" aria-label={etiqueta} className={conBuscador ? "px-1 pb-1" : ""}>
            {visibles.map(([v, label], idx) => {
              const sel = v === value;
              const activo = idx === hi;
              return (
                <button
                  key={v}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  data-idx={idx}
                  onMouseEnter={() => setHi(idx)}
                  onClick={() => elegir(v)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                  style={sel ? { backgroundColor: "var(--brand-50)", color: BRAND, fontWeight: 500, boxShadow: activo ? `inset 0 0 0 1px color-mix(in srgb, ${BRAND} 35%, white)` : undefined } : activo ? { backgroundColor: "#f1f5f9", color: "#475569" } : { color: "#475569" }}
                >
                  <span className="truncate">{label}</span>
                  {sel ? <Check className="h-4 w-4 shrink-0" /> : null}
                </button>
              );
            })}
            {sinResultados}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
    );
  }
}