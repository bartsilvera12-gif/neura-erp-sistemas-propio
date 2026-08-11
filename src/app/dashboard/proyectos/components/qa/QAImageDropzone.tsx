"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { QAApiResp, QAArchivo } from "./types";
import { IconImage } from "./ui";

type Props = {
  projectId: string;
  obsId: string;
  onSubido: (archivo: QAArchivo) => void;
  onError: (mensaje: string) => void;
  /** Mientras esté activo se capturan los pegados de todo el documento. */
  capturarPaste: boolean;
};

const ACEPTADOS = "image/*,application/pdf";

/** Lo que más se usa en QA: pegar el screenshot con Ctrl/Cmd+V y escribir al lado. */
export default function QAImageDropzone({
  projectId,
  obsId,
  onSubido,
  onError,
  capturarPaste,
}: Props) {
  const [subiendo, setSubiendo] = useState(0);
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const subir = useCallback(
    async (archivos: File[]) => {
      const validos = archivos.filter((f) => f.size > 0);
      if (validos.length === 0) return;
      setSubiendo((n) => n + validos.length);
      try {
        for (const file of validos) {
          const form = new FormData();
          form.append("file", file);
          const res = await fetchWithSupabaseSession(
            `/api/proyectos/${projectId}/qa/observaciones/${obsId}/archivos`,
            { method: "POST", body: form }
          );
          const j = (await res.json().catch(() => null)) as QAApiResp<QAArchivo> | null;
          if (!res.ok || !j?.success || !j.data) {
            onError(j?.error ?? `No se pudo subir "${file.name}"`);
            continue;
          }
          onSubido(j.data);
        }
      } finally {
        setSubiendo((n) => Math.max(0, n - validos.length));
      }
    },
    [projectId, obsId, onSubido, onError]
  );

  // Pegado desde el portapapeles. El listener es del documento porque el foco
  // suele estar en el textarea de la descripción cuando se pega la captura.
  useEffect(() => {
    if (!capturarPaste) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const archivos: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind !== "file") continue;
        const f = item.getAsFile();
        // Una captura pegada llega sin nombre: se le pone uno para el storage.
        if (f) {
          archivos.push(
            f.name && f.name !== "image.png"
              ? f
              : new File([f], `captura-${Date.now()}.${(f.type.split("/")[1] || "png").slice(0, 4)}`, {
                  type: f.type,
                })
          );
        }
      }
      if (archivos.length === 0) return;
      e.preventDefault();
      void subir(archivos);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [capturarPaste, subir]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        void subir([...e.dataTransfer.files]);
      }}
      className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
        arrastrando ? "border-[#4FAEB2] bg-[#4FAEB2]/5" : "border-slate-200 bg-slate-50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACEPTADOS}
        multiple
        className="hidden"
        onChange={(e) => {
          void subir([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {/* Input aparte para la cámara: en Capacitor/Android abre directamente la app de foto. */}
      <input
        id={`qa-camara-${obsId}`}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void subir([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      <div className="flex flex-col items-center gap-2 text-xs text-slate-500">
        <span className="text-slate-400">
          <IconImage size={20} />
        </span>
        {subiendo > 0 ? (
          <span className="font-medium text-[#3F8E91]">
            Subiendo {subiendo} archivo{subiendo > 1 ? "s" : ""}…
          </span>
        ) : (
          <span>
            Pegá con <kbd className="rounded border border-slate-300 bg-white px-1">Ctrl/Cmd+V</kbd>,
            arrastrá el archivo o
          </span>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 transition-colors hover:border-[#4FAEB2]/50 hover:text-[#3F8E91]"
          >
            Elegir archivo
          </button>
          <label
            htmlFor={`qa-camara-${obsId}`}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 transition-colors hover:border-[#4FAEB2]/50 hover:text-[#3F8E91] sm:hidden"
          >
            Sacar foto
          </label>
        </div>
      </div>
    </div>
  );
}
