"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Unlock, ShieldAlert } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Estado = {
  tiene_instancia: boolean;
  instalado?: boolean;
  suspendido?: boolean | null;
  puede_operar?: boolean;
  schema?: string;
};
type ApiResp<T> = { success: boolean; data?: T; error?: string };

/**
 * Botón "Bloquear / Habilitar acceso al ERP" (bloqueo por falta de pago).
 * Autocontenido: resuelve solo su visibilidad y estado desde /api/clientes/:id/acceso-erp.
 * Solo aparece para quien puede operar (Admin o Juliana) y si el cliente tiene ERP resuelto.
 */
export default function ClienteAccesoErpBoton({ clienteId }: { clienteId: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/acceso-erp`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as ApiResp<Estado> | null;
      if (res.ok && j?.success && j.data) setEstado(j.data);
      else setEstado({ tiene_instancia: false });
    } catch {
      setEstado({ tiene_instancia: false });
    }
  }, [clienteId]);

  useEffect(() => { void cargar(); }, [cargar]);

  if (!estado || !estado.puede_operar || !estado.tiene_instancia) return null;

  const suspendido = estado.suspendido === true;
  const instalado = estado.instalado !== false;

  async function confirmar() {
    if (!suspendido && !motivo.trim()) { setError("El motivo es obligatorio."); return; }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/acceso-erp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: suspendido ? "habilitar" : "bloquear", motivo: motivo.trim() }),
      });
      const j = (await res.json().catch(() => null)) as ApiResp<{ suspendido: boolean }> | null;
      if (!res.ok || !j?.success) { setError(j?.error ?? "No se pudo completar la acción."); return; }
      setAbierto(false);
      setMotivo("");
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  if (!instalado) {
    return (
      <button
        type="button"
        disabled
        title="El ERP de este cliente todavía no tiene el bloqueo instalado."
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-400"
      >
        <ShieldAlert className="h-3.5 w-3.5" /> Bloqueo no disponible
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setMotivo(""); setAbierto(true); }}
        className={
          suspendido
            ? "inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100"
            : "inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-100"
        }
      >
        {suspendido ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        {suspendido ? "Habilitar acceso" : "Bloquear acceso"}
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !guardando && setAbierto(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className={`grid h-9 w-9 place-items-center rounded-full ${suspendido ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                {suspendido ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </span>
              <h3 className="text-base font-semibold text-slate-900">
                {suspendido ? "Habilitar acceso al ERP" : "Bloquear acceso al ERP"}
              </h3>
            </div>

            <p className="mt-3 text-sm text-slate-600">
              {suspendido
                ? "El cliente volverá a entrar a su ERP normalmente. Queda registrado en el historial."
                : "El cliente verá la pantalla de “Acceso suspendido por falta de pago” al entrar a su ERP. Se puede revertir en cualquier momento. Queda registrado en el historial."}
            </p>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Motivo {suspendido ? "(opcional)" : "(obligatorio)"}
            </label>
            <textarea
              rows={2}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
              placeholder={suspendido ? "Ej: pago regularizado" : "Ej: cuota de noviembre impaga"}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              autoFocus
            />

            {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAbierto(false)}
                disabled={guardando}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={guardando}
                className={
                  suspendido
                    ? "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    : "rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 disabled:opacity-50"
                }
              >
                {guardando ? "Guardando…" : suspendido ? "Habilitar acceso" : "Bloquear acceso"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
