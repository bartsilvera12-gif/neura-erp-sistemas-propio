"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { coincideBusqueda, tokenizarBusqueda } from "@/lib/proyectos/busqueda";
import { nombreCapitular } from "@/lib/format/nombres";

export type PersonaOpcion = { id: string; nombre?: string | null; email?: string | null };

/**
 * Selector de UNA persona con buscador.
 *
 * El `<select>` nativo obliga a recorrer una lista de 15 nombres en MAYÚSCULAS
 * a ojo. Acá se escribe y se filtra.
 *
 * La búsqueda usa `coincideBusqueda`, el mismo normalizador del buscador de
 * proyectos: ignora acentos y mayúsculas y pide que TODOS los términos estén
 * presentes en cualquier orden, así "gonz ivan" encuentra a "IVAN RODRIGO
 * GONZALEZ" — con un `includes` plano no aparecería. También busca por email,
 * que es lo único que distingue a dos homónimos.
 *
 * El panel va en un portal con `position: fixed`: dentro de un modal con
 * scroll, un desplegable absoluto se recorta contra el borde del contenedor.
 */
export function PersonaSearchSelect({
  personas,
  value,
  onChange,
  placeholder = "Sin asignar",
  vacioLabel = "Sin asignar",
  disabled = false,
  ariaLabel,
}: {
  personas: PersonaOpcion[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Texto de la opción que limpia la selección. */
  vacioLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const etiqueta = (p: PersonaOpcion) => {
    const n = nombreCapitular(p.nombre);
    return n !== "—" ? n : (p.email ?? "").trim() || p.id.slice(0, 8);
  };

  const elegida = useMemo(() => personas.find((p) => p.id === value) ?? null, [personas, value]);
  const tokens = useMemo(() => tokenizarBusqueda(busqueda), [busqueda]);
  const filtradas = useMemo(
    () => personas.filter((p) => coincideBusqueda(tokens, `${p.nombre ?? ""} ${p.email ?? ""}`)),
    [personas, tokens]
  );

  useEffect(() => {
    if (!abierto) return;
    const recalcular = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    recalcular();
    // Captura: el modal scrollea en un contenedor interno, no en window.
    window.addEventListener("scroll", recalcular, true);
    window.addEventListener("resize", recalcular);
    return () => {
      window.removeEventListener("scroll", recalcular, true);
      window.removeEventListener("resize", recalcular);
    };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const alClickear = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-persona-panel]")) return;
      setAbierto(false);
      setBusqueda("");
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        setBusqueda("");
      }
    };
    document.addEventListener("mousedown", alClickear);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("mousedown", alClickear);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto]);

  useEffect(() => {
    if (abierto) inputRef.current?.focus();
  }, [abierto]);

  function elegir(id: string) {
    onChange(id);
    setAbierto(false);
    setBusqueda("");
  }

  const panel =
    abierto && pos
      ? createPortal(
          <div
            data-persona-panel=""
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            /*
              El panel cuelga de `body` (portal), asi que compite en el stacking
              context RAIZ contra los modales, que llegan a z-[110]. Con un
              z-index menor el panel se abre pero queda DETRAS del modal: se ve
              girar el chevron y nada mas, o sea "el selector no despliega".
              Mismo valor que FancySelect, que ya habia pasado por esto.
            */
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 1000 }}
            // Sin frenar la propagacion, el "click afuera" del modal que lo
            // contiene se dispara al elegir y cierra todo.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 p-2">
              <input
                ref={inputRef}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar persona…"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/25"
              />
            </div>
            <ul className="max-h-60 overflow-y-auto py-1">
              <li>
                <button
                  type="button"
                  onClick={() => elegir("")}
                  className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${
                    value === "" ? "font-semibold text-[#2F6E71]" : "text-slate-500"
                  }`}
                >
                  {vacioLabel}
                </button>
              </li>
              {filtradas.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-slate-400">Sin coincidencias.</li>
              ) : (
                filtradas.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => elegir(p.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${
                        p.id === value ? "font-semibold text-[#2F6E71]" : "text-slate-700"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{etiqueta(p)}</span>
                      {p.id === value ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`min-w-0 flex-1 truncate ${elegida ? "text-slate-900" : "text-slate-400"}`}>
          {elegida ? etiqueta(elegida) : placeholder}
        </span>
        <span aria-hidden="true" className={`shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {panel}
    </div>
  );
}
