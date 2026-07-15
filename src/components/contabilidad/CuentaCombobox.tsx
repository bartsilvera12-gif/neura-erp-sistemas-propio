"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CuentaContableOpcion } from "@/lib/compras/storage";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40 bg-white";

/** Combobox pequeño con buscador inteligente (código o denominación, sin acentos) para elegir una cuenta contable. */
export default function CuentaCombobox({
  cuentas, value, onChange, placeholder = "(Elegir cuenta contable)", allowClear = true,
}: {
  cuentas: CuentaContableOpcion[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = cuentas.find((c) => c.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const s = norm(q.trim());
    const base = s
      ? cuentas.filter((c) => c.cuenta.toLowerCase().includes(s) || norm(c.denominacion).includes(s))
      : cuentas;
    return base.slice(0, 40);
  }, [cuentas, q]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${INPUT} flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${selected ? "text-slate-700" : "text-slate-400"}`}>
          {selected ? `${selected.cuenta} — ${selected.denominacion}` : placeholder}
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>
      {open && (
        <div className="mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por código o denominación…"
            className="w-full border-b border-slate-100 px-2.5 py-2 text-sm outline-none"
          />
          <ul className="max-h-56 overflow-y-auto py-1">
            {allowClear && selected && (
              <li>
                <button type="button" onClick={() => { onChange(null); setOpen(false); setQ(""); }}
                  className="block w-full px-2.5 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-50">
                  (Quitar cuenta)
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-2.5 py-2 text-xs text-slate-400">Sin resultados</li>
            ) : filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => { onChange(c.id); setOpen(false); setQ(""); }}
                  className={`block w-full px-2.5 py-1.5 text-left text-xs hover:bg-[#4FAEB2]/10 ${c.id === value ? "bg-[#4FAEB2]/10 font-semibold" : ""}`}
                >
                  <span className="font-mono text-slate-600">{c.cuenta}</span> — {c.denominacion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
