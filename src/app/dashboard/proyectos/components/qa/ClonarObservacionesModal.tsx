"use client";

import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { QAApiResp } from "./types";
import { BTN_GHOST_CLS, BTN_PRIMARY_CLS, SELECT_CLS } from "./ui";

type ProyectoDisponible = { id: string; titulo: string | null };

type Props = {
  projectId: string;
  onClose: () => void;
  onClonado: () => void | Promise<void>;
};

/** Mismo flujo que el "Clonar QA" del checklist, sobre las observaciones. */
export default function ClonarObservacionesModal({ projectId, onClose, onClonado }: Props) {
  const [proyectos, setProyectos] = useState<ProyectoDisponible[]>([]);
  const [cargando, setCargando] = useState(true);
  const [elegido, setElegido] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const res = await fetchWithSupabaseSession(
        `/api/proyectos/${projectId}/qa/observaciones/proyectos-disponibles`,
        { cache: "no-store" }
      );
      const j = (await res.json().catch(() => null)) as QAApiResp<ProyectoDisponible[]> | null;
      if (!vivo) return;
      if (res.ok && j?.success && Array.isArray(j.data)) setProyectos(j.data);
      else setErr(j?.error ?? "No se pudieron cargar los proyectos");
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [projectId]);

  async function clonar() {
    if (!elegido || enviando) return;
    setEnviando(true);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/proyectos/${projectId}/qa/observaciones/clonar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from_proyecto_id: elegido }),
        }
      );
      const j = (await res.json().catch(() => null)) as QAApiResp<unknown> | null;
      if (!res.ok || !j?.success) {
        setErr(j?.error ?? "No se pudo clonar");
        return;
      }
      await onClonado();
      onClose();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Clonar observaciones"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-[#4FAEB2]" />
          <h2 className="text-sm font-semibold text-slate-900">Clonar observaciones</h2>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Copia el listado de otro proyecto como molde: título, descripción, severidad, origen y
          sección. <strong>No</strong> copia estados, asignaciones, adjuntos ni comentarios — todo
          entra como pendiente.
        </p>

        {cargando ? (
          <p className="mt-4 text-sm text-slate-400">Cargando proyectos…</p>
        ) : proyectos.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Ningún otro proyecto tiene observaciones cargadas todavía.
          </p>
        ) : (
          <select
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
            className={`${SELECT_CLS} mt-4 w-full`}
            aria-label="Proyecto de origen"
          >
            <option value="">Elegí el proyecto de origen…</option>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.titulo ?? "Sin título"}
              </option>
            ))}
          </select>
        )}

        {err ? <p className="mt-3 text-xs text-rose-600">{err}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_GHOST_CLS}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void clonar()}
            disabled={!elegido || enviando}
            className={BTN_PRIMARY_CLS}
          >
            {enviando ? "Clonando…" : "Clonar"}
          </button>
        </div>
      </div>
    </div>
  );
}
