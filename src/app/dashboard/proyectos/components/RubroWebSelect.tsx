"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RUBROS_WEB_LABELS } from "@/lib/proyectos/rubros-web";

const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

type Props = {
  value: string;
  onChange: (label: string) => void;
  inputClassName?: string;
  placeholder?: string;
};

/**
 * Buscador inteligente de rubro de negocio para proyectos web. Filtra la lista canónica
 * (sin acentos) y permite cargar un rubro propio ("Usar «…»") si no está en la lista.
 */
export function RubroWebSelect({ value, onChange, inputClassName, placeholder }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const t = norm(q);
    if (!t) return RUBROS_WEB_LABELS;
    return RUBROS_WEB_LABELS.filter((l) => norm(l).includes(t));
  }, [q]);

  // Si lo tipeado no coincide EXACTO con una etiqueta, ofrecer usarlo tal cual (rubro propio).
  const customDisponible = useMemo(() => {
    const t = q.trim();
    if (!t) return null;
    const yaEsta = RUBROS_WEB_LABELS.some((l) => norm(l) === norm(t));
    return yaEsta ? null : t;
  }, [q]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const inputCls =
    inputClassName ??
    "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";

  function pick(label: string) {
    onChange(label);
    setQ("");
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        className={inputCls}
        placeholder={placeholder ?? "Buscar rubro… (ej. tienda, inmobiliaria, gastronomía)"}
        value={open ? q : value}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Rubro de la web"
      />

      {open ? (
        <ul
          className="absolute left-0 right-0 z-20 mt-1.5 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-[#4FAEB2]/10"
          role="listbox"
        >
          {filtered.map((l) => {
            const isSel = norm(l) === norm(value);
            return (
              <li key={l}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors ${
                    isSel ? "bg-[#4FAEB2]/10 text-[#3F8E91]" : "text-slate-800 hover:bg-[#4FAEB2]/8 hover:text-[#3F8E91]"
                  }`}
                  onClick={() => pick(l)}
                >
                  <span className="truncate">{l}</span>
                  {isSel ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4 text-[#4FAEB2]"
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
          {customDisponible ? (
            <li className="border-t border-slate-100">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/8"
                onClick={() => pick(customDisponible)}
              >
                <span className="text-slate-400">+</span>
                <span className="truncate">
                  Usar &laquo;<span className="font-semibold">{customDisponible}</span>&raquo;
                </span>
              </button>
            </li>
          ) : null}
          {filtered.length === 0 && !customDisponible ? (
            <li className="px-3.5 py-2 text-sm text-slate-400">Sin coincidencias</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
