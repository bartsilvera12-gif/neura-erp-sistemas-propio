"use client";

import { useState } from "react";

type Props = {
  projectId: string;
  initialValue: boolean;
  onChange?: (nuevo: boolean) => void;
};

/**
 * Toggle admin: habilita runs "authenticated_read_only" sin env-assert.
 * Muestra advertencia clara antes de activar. El servidor valida el rol.
 */
export default function PermiteLecturaToggle({ projectId, initialValue, onChange }: Props) {
  const [valor, setValor] = useState<boolean>(initialValue);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    const nuevo = !valor;
    if (nuevo) {
      const confirma = window.confirm(
        "Vas a permitir que QA Center corra pruebas funcionales de lectura contra el ERP SIN " +
        "consultar env-assert. Confirmás que:\n\n" +
        "  1) Existe un usuario QA de SÓLO LECTURA en el ERP.\n" +
        "  2) Sus credenciales están cargadas en el runner (QA_RO_EMAIL / QA_RO_PASSWORD).\n" +
        "  3) Las pruebas sólo harán GET, nunca POST/PUT/DELETE.\n\n" +
        "¿Continuar?"
      );
      if (!confirma) return;
    }
    setCargando(true); setErr(null);
    try {
      const res = await fetch(`/api/qa/admin/project/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permite_lectura_sin_env_assert: nuevo }),
      });
      // Defensa contra respuesta sin body: leemos texto y parseamos con fallback.
      const text = await res.text();
      let body: { error?: string } = {};
      try { body = text ? (JSON.parse(text) as { error?: string }) : {}; } catch { /* body no-json */ }
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
        return;
      }
      setValor(nuevo);
      onChange?.(nuevo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div
      className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
      data-testid="permite-lectura-toggle"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-slate-800">
            Autorizar lectura funcional sin env-assert
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Bajo responsabilidad del admin del proyecto. El runner correrá suites
            de sólo lectura con el usuario QA del ERP.
          </p>
        </div>
        <button
          onClick={() => void toggle()}
          disabled={cargando}
          className={`rounded border px-2 py-1 font-medium transition ${
            valor
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
          } disabled:opacity-60`}
        >
          {cargando ? "Guardando…" : valor ? "✓ Autorizado" : "Autorizar"}
        </button>
      </div>
      {err && <p className="mt-1 text-[11px] text-rose-600">Error: {err}</p>}
    </div>
  );
}
