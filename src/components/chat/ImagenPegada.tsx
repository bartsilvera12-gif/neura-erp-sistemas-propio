"use client";

import { useEffect, useMemo } from "react";

/**
 * Imagen pegada en el chat (Ctrl/Cmd+V o "Pegar" en el celular).
 *
 * No se manda sola: se muestra una vista previa con Enviar / Cancelar, porque un pegado sin
 * querer mandaría una imagen al cliente sin vuelta atrás.
 */

/** La imagen del portapapeles del evento `paste`, si hay una. Si no, null (pegado normal). */
export function imagenDelPortapapeles(e: React.ClipboardEvent): File | null {
  const items = Array.from(e.clipboardData?.items ?? []);
  const item = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
  const f = item?.getAsFile();
  if (!f) return null;
  // El portapapeles la trae como "image.png"; un nombre con fecha se entiende mejor en el chat.
  const ext = (f.type.split("/")[1] || "png").split(";")[0];
  return new File([f], `imagen-${Date.now()}.${ext}`, { type: f.type });
}

export default function ImagenPegada({
  archivo,
  enviando,
  alEnviar,
  alCancelar,
}: {
  archivo: File;
  enviando?: boolean;
  alEnviar: () => void;
  alCancelar: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(archivo), [archivo]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Imagen pegada" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1 text-[13px] text-slate-600">
        <p className="font-semibold text-slate-800">Imagen pegada</p>
        <p className="text-[12px]">¿La enviás al cliente?</p>
      </div>
      <button
        type="button"
        onClick={alCancelar}
        disabled={enviando}
        className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={alEnviar}
        disabled={enviando}
        className="shrink-0 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        {enviando ? "Enviando…" : "Enviar"}
      </button>
    </div>
  );
}
