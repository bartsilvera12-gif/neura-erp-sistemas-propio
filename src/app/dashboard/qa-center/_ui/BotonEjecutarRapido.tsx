"use client";

/**
 * Botón pequeño que dispara el endpoint /api/qa/interactuar-agente/<id>
 * para un proyecto puntual. Reemplaza EjecutarQaButton (que requiere
 * selector de suite) cuando ya sabemos exactamente qué proyecto correr.
 */
import { useState } from "react";

export default function BotonEjecutarRapido({ projectId, projectSlug }: { projectId: string; projectSlug: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "fail"; texto: string } | null>(null);

  async function ejecutar(): Promise<void> {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/qa/interactuar-agente/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: `ejec-${Date.now()}` }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tipo: "fail", texto: body.error ?? `HTTP ${res.status}` });
      } else {
        setMsg({ tipo: "ok", texto: `run ${body.run_id?.slice(0, 8) ?? "?"}` });
      }
    } catch (e) {
      setMsg({ tipo: "fail", texto: e instanceof Error ? e.message : "error de red" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {msg && (
        <span className={`text-[11px] font-medium ${msg.tipo === "ok" ? "text-emerald-700" : "text-rose-700"}`}>
          {msg.texto}
        </span>
      )}
      <button
        onClick={() => void ejecutar()}
        disabled={busy}
        data-testid={`btn-ejecutar-${projectSlug}`}
        className="rounded-lg bg-[#0EA5E9] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#0284C7] hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Encolando…" : "Ejecutar sandbox"}
      </button>
    </div>
  );
}
