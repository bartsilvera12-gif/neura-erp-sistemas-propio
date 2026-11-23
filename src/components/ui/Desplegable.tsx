"use client";

/**
 * Desplegable — reemplazo directo de `<select>` con el diseño de la página.
 *
 * Se usa IGUAL que un select: mismas props (`value`, `onChange`, `disabled`, `name`,
 * `required`, `aria-label`, `className`, `style`) y los mismos `<option>` adentro. Para pasar
 * una pantalla alcanza con cambiar la etiqueta: `<select …>` → `<Desplegable …>`.
 *
 * Cómo lo logra: el `<select>` real sigue en la página, escondido, y es el que guarda el valor.
 * Al elegir una opción se le cambia el valor y se dispara su evento `change`, así el `onChange`
 * de siempre recibe el mismo evento (`e.target.value`), los formularios lo envían y `required`
 * se sigue validando. Lo único que cambia es lo que se ve.
 *
 * En pantallas táctiles (celular, app) se deja el select del sistema: su selector nativo es más
 * cómodo con el dedo y la app no cambia.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

type Opcion = { value: string; label: string; disabled: boolean; grupo: string | null; i: number };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const ALTO_MAX = 320;
const MARGEN = 6;
/** A partir de cuántas opciones aparece el buscador. */
const BUSCADOR_DESDE = 9;

function leerOpciones(sel: HTMLSelectElement | null): Opcion[] {
  if (!sel) return [];
  return Array.from(sel.options).map((o, i) => ({
    value: o.value,
    label: o.label || o.text,
    disabled: o.disabled,
    grupo: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : null,
    i,
  }));
}

export function Desplegable({ className = "", style, children, disabled, ...resto }: SelectHTMLAttributes<HTMLSelectElement>) {
  const selRef = useRef<HTMLSelectElement>(null);
  const cajaRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const idLista = useId();
  const [tactil, setTactil] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [etiqueta, setEtiqueta] = useState("");
  const [esVacio, setEsVacio] = useState(false);
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [q, setQ] = useState("");
  const [activa, setActiva] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => {
    setTactil(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Lo que muestra la caja sale del select real: se relee en cada render (cambió el valor o las
  // opciones). No es una cadena infinita: si el texto es el mismo, React no vuelve a renderizar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sel = selRef.current;
    if (!sel) return;
    const o = sel.selectedOptions[0];
    setEtiqueta(o ? o.label || o.text : "");
    setEsVacio(!o || o.value === "");
  });

  const visibles = useMemo(() => {
    const n = norm(q.trim());
    return n ? opciones.filter((o) => norm(o.label).includes(n)) : opciones;
  }, [opciones, q]);

  const ubicar = useCallback(() => {
    const caja = cajaRef.current?.getBoundingClientRect();
    if (!caja) return;
    const abajo = window.innerHeight - caja.bottom - MARGEN * 2;
    const arriba = caja.top - MARGEN * 2;
    const haciaArriba = abajo < 180 && arriba > abajo;
    const width = Math.max(caja.width, 190);
    setPos({
      left: Math.max(MARGEN, Math.min(caja.left, window.innerWidth - width - MARGEN)),
      width,
      maxHeight: Math.max(140, Math.min(ALTO_MAX, haciaArriba ? arriba : abajo)),
      ...(haciaArriba ? { bottom: window.innerHeight - caja.top + MARGEN } : { top: caja.bottom + MARGEN }),
    });
  }, []);

  const abrir = useCallback(() => {
    if (disabled) return;
    const ops = leerOpciones(selRef.current);
    setOpciones(ops);
    setQ("");
    setActiva(Math.max(0, ops.findIndex((o) => o.value === selRef.current?.value)));
    ubicar();
    setAbierto(true);
  }, [disabled, ubicar]);

  const cerrar = useCallback((devolverFoco = true) => {
    setAbierto(false);
    if (devolverFoco) cajaRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (cajaRef.current?.contains(t) || listaRef.current?.contains(t)) return;
      cerrar(false);
    };
    window.addEventListener("scroll", ubicar, true);
    window.addEventListener("resize", ubicar);
    document.addEventListener("mousedown", fuera);
    return () => {
      window.removeEventListener("scroll", ubicar, true);
      window.removeEventListener("resize", ubicar);
      document.removeEventListener("mousedown", fuera);
    };
  }, [abierto, ubicar, cerrar]);

  // La opción marcada con el teclado siempre a la vista.
  useEffect(() => {
    if (!abierto) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-i="${activa}"]`)?.scrollIntoView({ block: "nearest" });
  }, [abierto, activa]);

  /** Elegir = cambiarle el valor al select real y avisar con su propio evento `change`. */
  const elegir = (o: Opcion) => {
    const sel = selRef.current;
    if (!sel || o.disabled) return;
    if (sel.value !== o.value) {
      const poner = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      poner?.call(sel, o.value);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    cerrar();
  };

  const mover = (paso: number) => {
    if (!visibles.length) return;
    let k = activa;
    for (let n = 0; n < visibles.length; n++) {
      k = (k + paso + visibles.length) % visibles.length;
      if (!visibles[k].disabled) break;
    }
    setActiva(k);
  };

  const teclaEnLista = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); mover(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActiva(0); }
    else if (e.key === "End") { e.preventDefault(); setActiva(Math.max(0, visibles.length - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (visibles[activa]) elegir(visibles[activa]); }
    else if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.preventDefault(); cerrar(); }
  };

  // Celular / app: el select del sistema, sin tocar.
  if (tactil) {
    return (
      <select ref={selRef} className={className} style={style} disabled={disabled} {...resto}>
        {children}
      </select>
    );
  }

  // Si la pantalla ya le dibujaba su flecha como fondo, no se suma otra.
  const traeFlecha = Boolean(style?.backgroundImage) || className.includes("bg-[url");
  const conBuscador = opciones.length >= BUSCADOR_DESDE;

  return (
    <>
      <div
        ref={cajaRef}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        aria-label={resto["aria-label"]}
        aria-disabled={disabled || undefined}
        title={resto.title}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={(e) => {
          if (abierto) return;
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); abrir(); }
        }}
        className={`${className} relative flex select-none items-center gap-2 text-left outline-none focus-visible:border-[#4FAEB2] focus-visible:ring-2 focus-visible:ring-[#4FAEB2]/20 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${abierto ? "border-[#4FAEB2] ring-2 ring-[#4FAEB2]/20" : ""}`}
        style={style}
      >
        <span className={`min-w-0 flex-1 truncate ${esVacio ? "text-slate-500" : ""}`}>{etiqueta || " "}</span>
        {traeFlecha ? null : <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`} />}
        {/* El select real: guarda el valor, viaja en los formularios y sostiene `required`. */}
        <select
          ref={selRef}
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          {...resto}
          className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px opacity-0"
        >
          {children}
        </select>
      </div>

      {abierto && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listaRef}
              className="fixed z-[1000] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
              onKeyDown={teclaEnLista}
            >
              {conBuscador ? (
                <div className="relative shrink-0 border-b border-slate-100 p-1.5">
                  <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setActiva(0); }}
                    placeholder="Buscar…"
                    aria-label="Buscar opción"
                    className="w-full rounded-lg bg-slate-50 py-1.5 pl-8 pr-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#4FAEB2]/20"
                  />
                </div>
              ) : null}
              <ul id={idLista} role="listbox" tabIndex={-1} ref={(el) => { if (el && !conBuscador) el.focus(); }} className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-1 outline-none">
                {visibles.length === 0 ? <li className="px-3 py-3 text-center text-xs text-slate-400">Sin resultados</li> : null}
                {visibles.map((o, k) => {
                  const elegida = o.value === selRef.current?.value;
                  const titulo = o.grupo && o.grupo !== (visibles[k - 1]?.grupo ?? null) ? o.grupo : null;
                  return (
                    <li key={`${o.i}-${o.value}`} role="presentation">
                      {titulo ? <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{titulo}</p> : null}
                      <div
                        role="option"
                        aria-selected={elegida}
                        aria-disabled={o.disabled || undefined}
                        data-i={k}
                        onMouseEnter={() => setActiva(k)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => elegir(o)}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] leading-snug ${
                          o.disabled ? "cursor-not-allowed text-slate-300" : "cursor-pointer"
                        } ${elegida ? "bg-[#4FAEB2]/12 font-semibold text-[#2F6E71]" : k === activa && !o.disabled ? "bg-slate-100 text-slate-900" : "text-slate-700"}`}
                      >
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{o.label || " "}</span>
                        {elegida ? <Check aria-hidden className="h-4 w-4 shrink-0 text-[#3F8E91]" /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
