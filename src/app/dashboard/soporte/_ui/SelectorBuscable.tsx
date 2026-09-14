"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, Sparkles, X } from "lucide-react";
import { Avatar, TONOS, type Tono } from "./ui";

export type OpcionSelector = {
  value: string;
  label: string;
  /** Texto chico en una píldora de color (el área, por ejemplo). */
  detalle?: string;
  tono?: Tono;
  /** Resaltada arriba con un distintivo, como los responsables sugeridos. */
  sugerida?: boolean;
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Pinta en negrita la parte del texto que coincide con la búsqueda. */
function Resaltado({ texto, q }: { texto: string; q: string }) {
  if (!q) return <>{texto}</>;
  const i = norm(texto).indexOf(q);
  if (i < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <mark className="rounded bg-[#4FAEB2]/20 px-0.5 text-inherit">{texto.slice(i, i + q.length)}</mark>
      {texto.slice(i + q.length)}
    </>
  );
}

const ALTO_LISTA = 300;
const MARGEN = 8;

/**
 * Selector con buscador para Soporte (clientes, responsables).
 *
 * Propio del módulo a propósito: FancySelect y SmartCombobox se usan en todo el
 * ERP y cambiarlos acá arrastraría Proyectos. El menú va en un portal con
 * posición fija para que ni la tabla ni un modal lo recorten.
 */
export function SelectorBuscable({
  opciones,
  value,
  onChange,
  placeholder = "Seleccionar…",
  ariaLabel,
  disabled = false,
  avatares = false,
  buscarPlaceholder = "Buscar…",
  vacio = "Sin resultados",
  tam = "md",
}: {
  opciones: OpcionSelector[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Muestra la inicial de color de cada opción (personas, clientes). */
  avatares?: boolean;
  buscarPlaceholder?: string;
  vacio?: string;
  tam?: "sm" | "md";
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; alto: number } | null>(null);
  const idLista = useId();

  const elegida = opciones.find((o) => o.value === value) ?? null;
  const qn = norm(q.trim());
  const visibles = useMemo(
    () => (qn ? opciones.filter((o) => norm(o.label).includes(qn) || (o.detalle && norm(o.detalle).includes(qn))) : opciones),
    [opciones, qn]
  );

  const abrir = () => {
    if (disabled) return;
    setQ("");
    setActivo(Math.max(0, opciones.findIndex((o) => o.value === value)));
    setAbierto(true);
  };
  const cerrar = useCallback((devolverFoco = false) => {
    setAbierto(false);
    if (devolverFoco) trigger.current?.focus();
  }, []);
  const elegir = (o: OpcionSelector | undefined) => {
    if (!o) return;
    onChange(o.value);
    cerrar(true);
  };

  const ubicar = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const abajo = window.innerHeight - r.bottom - MARGEN;
    const arriba = r.top - MARGEN;
    const total = ALTO_LISTA + 64;
    const haciaArriba = abajo < total && arriba > abajo;
    const width = Math.max(r.width, 260);
    const left = Math.min(Math.max(MARGEN, r.left), Math.max(MARGEN, window.innerWidth - width - MARGEN));
    setPos({
      left,
      width,
      ...(haciaArriba ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      alto: Math.max(140, Math.min(ALTO_LISTA, (haciaArriba ? arriba : abajo) - 70)),
    });
  }, []);

  useLayoutEffect(() => {
    if (abierto) ubicar();
  }, [abierto, ubicar]);

  useEffect(() => {
    if (!abierto) return;
    buscador.current?.focus();
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !pop.current?.contains(t)) cerrar();
    };
    document.addEventListener("mousedown", fuera);
    window.addEventListener("scroll", ubicar, true);
    window.addEventListener("resize", ubicar);
    return () => {
      document.removeEventListener("mousedown", fuera);
      window.removeEventListener("scroll", ubicar, true);
      window.removeEventListener("resize", ubicar);
    };
  }, [abierto, cerrar, ubicar]);

  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-i="${activo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activo, abierto]);

  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((i) => Math.min(visibles.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      elegir(visibles[activo]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cerrar(true);
    } else if (e.key === "Tab") {
      cerrar();
    }
  };

  const chico = tam === "sm";
  const vacia = !elegida || elegida.value === "";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={(e) => {
          if (!abierto && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            abrir();
          }
        }}
        className={`group flex w-full items-center gap-2.5 rounded-xl border bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 ${
          chico ? "px-2.5 py-1.5 text-[13px]" : "px-3 py-2 text-sm"
        } ${
          abierto
            ? "border-[#4FAEB2] ring-4 ring-[#4FAEB2]/15"
            : "border-slate-200 hover:border-[#4FAEB2]/60"
        }`}
      >
        {avatares && !vacia ? <Avatar nombre={elegida.label} tam={chico ? 20 : 24} /> : null}
        <span className={`min-w-0 flex-1 truncate ${vacia && !elegida ? "text-slate-400" : vacia ? "text-slate-500" : "font-medium text-slate-900"}`}>
          {elegida?.label ?? placeholder}
        </span>
        {elegida?.detalle && !chico ? (
          <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold sm:inline ${TONOS[elegida.tono ?? "pizarra"].suave} ${TONOS[elegida.tono ?? "pizarra"].texto}`}>
            {elegida.detalle}
          </span>
        ) : null}
        <span
          aria-hidden
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[#4FAEB2] transition ${abierto ? "rotate-180 bg-[#4FAEB2]/12" : "group-hover:bg-[#4FAEB2]/8"}`}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>

      {abierto && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={pop}
              style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 1000 }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_48px_-14px_rgba(15,23,42,0.28)] ring-1 ring-[#4FAEB2]/10"
            >
              <div className="border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/[0.07] to-sky-50/60 p-2">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]" aria-hidden />
                  <input
                    ref={buscador}
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setActivo(0);
                    }}
                    onKeyDown={teclas}
                    placeholder={buscarPlaceholder}
                    aria-label={buscarPlaceholder}
                    aria-controls={idLista}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-4 focus:ring-[#4FAEB2]/15"
                  />
                  {q ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQ("");
                        buscador.current?.focus();
                      }}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </label>
              </div>

              <ul ref={lista} id={idLista} role="listbox" style={{ maxHeight: pos.alto }} className="overflow-y-auto overscroll-contain p-1.5">
                {visibles.length === 0 ? (
                  <li className="px-3 py-6 text-center text-[13px] text-slate-400">{vacio}</li>
                ) : (
                  visibles.map((o, i) => {
                    const sel = o.value === value;
                    const act = i === activo;
                    const t = TONOS[o.tono ?? "pizarra"];
                    return (
                      <li key={`${o.value}-${i}`} role="none">
                        <button
                          type="button"
                          role="option"
                          aria-selected={sel}
                          data-i={i}
                          onMouseEnter={() => setActivo(i)}
                          onClick={() => elegir(o)}
                          className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors ${
                            act ? "bg-[#4FAEB2]/10" : sel ? "bg-[#4FAEB2]/[0.05]" : ""
                          }`}
                        >
                          {avatares ? (
                            o.value ? (
                              <Avatar nombre={o.label} tam={28} />
                            ) : (
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-slate-300 text-slate-400" aria-hidden>
                                <X className="h-3.5 w-3.5" />
                              </span>
                            )
                          ) : null}
                          <span className={`min-w-0 flex-1 truncate ${sel ? "font-semibold text-[#2F6E71]" : o.value ? "font-medium text-slate-700" : "text-slate-500"}`}>
                            <Resaltado texto={o.label} q={qn} />
                          </span>
                          {o.sugerida ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
                              <Sparkles className="h-3 w-3" aria-hidden /> Sugerido
                            </span>
                          ) : null}
                          {o.detalle ? (
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${t.suave} ${t.texto}`}>{o.detalle}</span>
                          ) : null}
                          <Check className={`h-4 w-4 shrink-0 text-[#4FAEB2] ${sel ? "" : "invisible"}`} aria-hidden />
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              {opciones.length > 8 ? (
                <p className="border-t border-slate-100 px-3 py-1.5 text-right text-[11px] tabular-nums text-slate-400">
                  {visibles.length} de {opciones.length}
                </p>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
