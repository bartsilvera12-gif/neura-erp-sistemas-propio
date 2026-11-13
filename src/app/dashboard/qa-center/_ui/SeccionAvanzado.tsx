"use client";

/**
 * Wrapper colapsable para las funciones manuales (suites, toggle,
 * encolar suite específica). Oculto por defecto para que la vista
 * principal del proyecto quede en el botón "Analizar ERP completo".
 */

import { useState, type ReactNode } from "react";

export default function SeccionAvanzado({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        data-testid="toggle-avanzado"
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
      >
        <span>Avanzado · opciones técnicas (suites manuales, lectura sin env-assert, allow-list…)</span>
        <span className="text-slate-400">{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && <div className="border-t border-slate-200 p-3">{children}</div>}
    </div>
  );
}
