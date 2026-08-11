"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconImage } from "./ui";

type Props = {
  /** Identificador único para el input de cámara (dos dropzones no pueden compartir id). */
  id: string;
  /** Recibe los archivos elegidos. Quien lo usa decide si sube ya o los junta. */
  onArchivos: (archivos: File[]) => void;
  /** Mientras esté activo se capturan los pegados de todo el documento. */
  capturarPaste: boolean;
  /** Cantidad en vuelo, para el cartel de progreso. */
  subiendo?: number;
  compacto?: boolean;
};

const ACEPTADOS = "image/*,application/pdf";

/**
 * Lo que más se usa en QA: pegar el screenshot con Ctrl/Cmd+V y escribir al lado.
 *
 * No hace fetch: emite `File[]`. El modal los sube contra una observación que ya
 * existe; el composer los retiene hasta que la observación se crea.
 */
export default function QAImageDropzone({
  id,
  onArchivos,
  capturarPaste,
  subiendo = 0,
  compacto = false,
}: Props) {
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const emitir = useCallback(
    (archivos: File[]) => {
      const validos = archivos.filter((f) => f.size > 0);
      if (validos.length > 0) onArchivos(validos);
    },
    [onArchivos]
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
      emitir(archivos);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [capturarPaste, emitir]);

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
        emitir([...e.dataTransfer.files]);
      }}
      className={`rounded-xl border-2 border-dashed text-center transition-colors ${
        compacto ? "px-3 py-2.5" : "px-4 py-5"
      } ${arrastrando ? "border-[#4FAEB2] bg-[#4FAEB2]/5" : "border-slate-200 bg-slate-50"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACEPTADOS}
        multiple
        className="hidden"
        onChange={(e) => {
          emitir([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {/* Input aparte para la cámara: en Capacitor/Android abre directamente la app de foto. */}
      <input
        id={`qa-camara-${id}`}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          emitir([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      <div
        className={`flex items-center justify-center gap-2 text-xs text-slate-500 ${
          compacto ? "flex-row flex-wrap" : "flex-col"
        }`}
      >
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
            htmlFor={`qa-camara-${id}`}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 transition-colors hover:border-[#4FAEB2]/50 hover:text-[#3F8E91] sm:hidden"
          >
            Sacar foto
          </label>
        </div>
      </div>
    </div>
  );
}
