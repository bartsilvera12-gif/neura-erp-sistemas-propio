"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { formatBytes, type AyudaAdjunto } from "@/app/configuracion/ayuda/types";

/**
 * Gestor de documentos adjuntos de un artículo (contrato en PDF, planillas…).
 * Solo aparece cuando el artículo ya existe: necesita un id para colgar el archivo.
 */
export default function AdjuntosEditor({ articuloId }: { articuloId: string }) {
  const [adjuntos, setAdjuntos] = useState<AyudaAdjunto[]>([]);
  const [loading, setLoading] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/configuracion/ayuda/${articuloId}/adjuntos`);
      const j = await r.json();
      if (r.ok && j?.success) setAdjuntos(j.data.adjuntos as AyudaAdjunto[]);
      else setError(j?.error ?? `Error ${r.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [articuloId]);

  useEffect(() => {
    load();
  }, [load]);

  const subir = useCallback(
    async (file: File) => {
      setSubiendo(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const r = await apiFetch(`/api/configuracion/ayuda/${articuloId}/adjuntos`, {
          method: "POST",
          body: fd,
        });
        const j = await r.json();
        if (!r.ok || !j?.success) {
          setError(j?.error ?? `Error ${r.status}`);
          return;
        }
        setAdjuntos((prev) => [...prev, j.data.adjunto as AyudaAdjunto]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red");
      } finally {
        setSubiendo(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [articuloId]
  );

  const eliminar = useCallback(
    async (adj: AyudaAdjunto) => {
      if (!window.confirm(`¿Quitar "${adj.nombre}"?`)) return;
      setError(null);
      try {
        const r = await apiFetch(`/api/configuracion/ayuda/${articuloId}/adjuntos/${adj.id}`, {
          method: "DELETE",
        });
        const j = await r.json();
        if (!r.ok || !j?.success) {
          setError(j?.error ?? `Error ${r.status}`);
          return;
        }
        setAdjuntos((prev) => prev.filter((a) => a.id !== adj.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red");
      }
    },
    [articuloId]
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          <Paperclip className="h-3.5 w-3.5" />
          Documentos adjuntos
        </h4>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={subiendo}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Subir documento
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) subir(f);
          }}
        />
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando…
        </div>
      ) : adjuntos.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">
          Todavía no hay documentos. Subí el contrato, una planilla o cualquier PDF que el equipo tenga que
          tener a mano. (Hasta 25 MB por archivo.)
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {adjuntos.map((adj) => (
            <li key={adj.id} className="flex items-center gap-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-700">{adj.nombre}</p>
                {adj.size_bytes ? (
                  <p className="text-xs text-slate-400">{formatBytes(adj.size_bytes)}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => eliminar(adj)}
                aria-label="Quitar documento"
                className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
