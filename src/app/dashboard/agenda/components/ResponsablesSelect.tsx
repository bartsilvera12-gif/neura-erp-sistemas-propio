"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { coincideBusqueda, tokenizarBusqueda } from "@/lib/proyectos/busqueda";
import { nombreCapitular } from "@/lib/format/nombres";

export type UsuarioOpcion = { id: string; nombre?: string | null };

/**
 * Selector de VARIOS responsables con buscador.
 *
 * El buscador usa `coincideBusqueda`, el mismo normalizador que el buscador de
 * proyectos: ignora acentos y mayúsculas y exige que todos los términos estén
 * presentes, en cualquier orden. Escribir "gonz ivan" encuentra a "IVAN RODRIGO
 * GONZALEZ" — con un `includes` plano no aparecería.
 *
 * El panel se monta en un portal con `position: fixed`, igual que FancySelect:
 * adentro de un modal con scroll, un desplegable absoluto se recorta contra el
 * borde del contenedor.
 */
export function ResponsablesSelect({
  opciones,
  valor,
  onChange,
  principalId,
  disabled = false,
}: {
  opciones: UsuarioOpcion[];
  /** Ids seleccionados. El primero es el responsable principal. */
  valor: string[];
  onChange: (ids: string[]) => void;
  /**
   * Id del principal (el primero de `valor`). Sólo se usa para marcarlo con el
   * chip: se puede desmarcar como cualquier otro, y el siguiente hereda el rol.
   */
  principalId: string | null;
  disabled?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const nombreDe = useMemo(() => {
    const m = new Map(opciones.map((o) => [o.id, nombreCapitular(o.nombre) !== "—" ? nombreCapitular(o.nombre) : o.id]));
    return (id: string) => m.get(id) ?? id;
  }, [opciones]);

  const tokens = useMemo(() => tokenizarBusqueda(busqueda), [busqueda]);
  const filtradas = useMemo(
    () => opciones.filter((o) => coincideBusqueda(tokens, `${o.nombre ?? ""} ${o.id}`)),
    [opciones, tokens]
  );

  // Reposiciona contra el viewport mientras está abierto (scroll y resize en
  // fase de captura: el modal scrollea en un contenedor interno, no en window).
  useEffect(() => {
    if (!abierto) return;
    const recalcular = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    recalcular();
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
      if ((t as HTMLElement).closest?.("[data-responsables-panel]")) return;
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

  function alternar(id: string) {
    if (valor.includes(id)) {
      // Cualquiera se puede sacar, el principal incluido: al quitarlo, el
      // siguiente de la lista hereda ese rol. Bloquearlo dejaba la primera
      // persona marcada sin forma de deshacer el clic.
      onChange(valor.filter((v) => v !== id));
    } else {
      onChange([...valor, id]);
    }
  }

  const panel =
    abierto && pos
      ? createPortal(
          <div
            data-responsables-panel=""
            className="z-[70] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width }}
          >
            <div className="border-b border-slate-100 p-2">
              <input
                ref={inputRef}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar persona…"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              {filtradas.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-slate-400">Sin coincidencias.</li>
              ) : (
                filtradas.map((o) => {
                  const elegido = valor.includes(o.id);
                  const esPrincipal = o.id === principalId;
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => alternar(o.id)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${
                          elegido ? "text-slate-900" : "text-slate-600"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            elegido ? "border-[#3F8E91] bg-[#3F8E91] text-white" : "border-slate-300"
                          }`}
                        >
                          {elegido ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{nombreDe(o.id)}</span>
                        {esPrincipal ? (
                          <span className="shrink-0 rounded-md bg-[#4FAEB2]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[#3F8E91]">
                            principal
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
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
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {valor.length === 0 ? (
            <span className="py-0.5 text-slate-400">Elegí responsables…</span>
          ) : (
            valor.map((id) => (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-[#4FAEB2]/12 px-1.5 py-0.5 text-[12px] font-medium text-[#3F8E91]"
              >
                <span className="truncate">{nombreDe(id)}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Quitar a ${nombreDe(id)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(valor.filter((v) => v !== id));
                  }}
                  className="cursor-pointer text-[#3F8E91]/60 hover:text-[#3F8E91]"
                >
                  ×
                </span>
              </span>
            ))
          )}
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
