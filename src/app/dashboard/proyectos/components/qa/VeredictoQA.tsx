"use client";

import { useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { INPUT_CLS } from "./ui";

/**
 * Cierre de una ronda de QA: aprobar o rechazar.
 *
 * No es un estado nuevo — mueve la misma `qa_etapa` que muestra el tablero del
 * equipo (aprobado → Finalizado, rechazado → Cambios), para que no existan dos
 * nociones de "en qué anda QA" que puedan contradecirse.
 *
 * El motivo del rechazo es obligatorio: viaja en la notificación que le llega
 * al programador, y sin él tiene que entrar a adivinar qué corregir.
 */
export default function VeredictoQA({ projectId }: { projectId: string }) {
  const [modo, setModo] = useState<"idle" | "rechazando">("idle");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hecho, setHecho] = useState<"aprobado" | "rechazado" | null>(null);

  async function enviar(aprobado: boolean) {
    setEnviando(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/qa/veredicto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aprobado, motivo: aprobado ? null : motivo.trim() }),
      });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !j?.success) {
        setErr(j?.error ?? "No se pudo registrar el veredicto");
        return;
      }
      setHecho(aprobado ? "aprobado" : "rechazado");
      setModo("idle");
      setMotivo("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Veredicto de QA</p>
          <p className="text-[11px] text-slate-500">
            {hecho === "aprobado"
              ? "Aprobado. Se le avisó a la project manager y a los responsables."
              : hecho === "rechazado"
                ? "Rechazado. Volvió a Cambios y se le avisó al equipo."
                : "Aprobar lo deja listo para entregar. Rechazar lo devuelve a Cambios."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={enviando}
            onClick={() => setModo((m) => (m === "rechazando" ? "idle" : "rechazando"))}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Rechazar
          </button>
          <button
            type="button"
            disabled={enviando}
            onClick={() => void enviar(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? "Enviando…" : "Aprobar"}
          </button>
        </div>
      </div>

      {modo === "rechazando" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (motivo.trim()) void enviar(false);
          }}
          className="mt-3 space-y-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2.5"
        >
          <label htmlFor="qa-motivo" className="text-[11px] font-bold uppercase tracking-wide text-rose-700">
            Motivo del rechazo
          </label>
          <input
            id="qa-motivo"
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: el checkout no valida el cupón vencido"
            className={INPUT_CLS}
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-rose-700">
              Se envía en la notificación al programador y al comercial.
            </span>
            <button
              type="button"
              onClick={() => setModo("idle")}
              className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando || !motivo.trim()}
              className="rounded-md bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-200"
            >
              {enviando ? "Enviando…" : "Rechazar"}
            </button>
          </div>
        </form>
      ) : null}

      {err ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          {err}
        </p>
      ) : null}
    </div>
  );
}
