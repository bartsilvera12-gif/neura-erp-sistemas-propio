"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const INPUT =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40 bg-white";

export interface ComboOption {
  id: string;
  label: string;
  sub?: string | null;
}

/**
 * Combobox chico con buscador inteligente (sin acentos, por cualquier palabra).
 * El panel va en flujo (no absolute) para que no se recorte dentro de modales.
 */
export default function SmartCombobox({
  options, value, onChange, placeholder = "(Elegir)", allowClear = true, disabled = false,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtradas = useMemo(() => {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const base = terms.length === 0
      ? options
      : options.filter((o) => {
          const hay = norm(`${o.label} ${o.sub ?? ""}`);
          return terms.every((t) => hay.includes(t));
        });
    return base.slice(0, 40);
  }, [options, q]);

  return (
    <div ref={ref} className="w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen((v) => !v); setQ(""); } }}
        className={`${INPUT} flex items-center justify-between text-left ${disabled ? "opacity-60" : ""}`}
      >
        <span className={selected ? "truncate text-slate-800" : "truncate text-slate-400"}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="ml-2 shrink-0 text-slate-400">▾</span>
      </button>

      {open && (
        <div className="mt-1 rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar…"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1 text-sm">
            {allowClear && (
              <li>
                <button type="button" onClick={() => { onChange(null); setOpen(false); }}
                  className="w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-50">
                  {placeholder}
                </button>
              </li>
            )}
            {filtradas.length === 0 ? (
              <li className="px-3 py-2 text-slate-400">Sin resultados.</li>
            ) : filtradas.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => { onChange(o.id); setOpen(false); }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-[#4FAEB2]/10 ${o.id === value ? "bg-[#4FAEB2]/10 font-medium" : ""}`}>
                  <span className="block truncate text-slate-800">{o.label}</span>
                  {o.sub && <span className="block truncate text-xs text-slate-400">{o.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
