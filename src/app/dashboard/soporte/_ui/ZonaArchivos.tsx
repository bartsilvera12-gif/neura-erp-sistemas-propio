"use client";

import { useRef, useState } from "react";
import { FileText, Film, ImageIcon, UploadCloud, X } from "lucide-react";
import { ARCHIVO_EXTENSIONES, ARCHIVO_MAX_BYTES, mimeAceptado, tamanoLegible } from "@/lib/soporte/dominio";

function IconoArchivo({ tipo }: { tipo: string }) {
  if (tipo.startsWith("image/")) return <ImageIcon className="h-4 w-4" aria-hidden />;
  if (tipo.startsWith("video/")) return <Film className="h-4 w-4" aria-hidden />;
  return <FileText className="h-4 w-4" aria-hidden />;
}

/**
 * Zona de arrastrar y soltar para evidencias.
 *
 * Valida tipo y tamaño apenas se sueltan los archivos, antes de cualquier
 * subida: descubrir que un .zip no se acepta después de esperar a que suba es
 * peor que enterarse al instante.
 */
export default function ZonaArchivos({
  archivos,
  onCambio,
  compacta = false,
  deshabilitada = false,
}: {
  archivos: File[];
  onCambio: (a: File[]) => void;
  compacta?: boolean;
  deshabilitada?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);
  const [rechazos, setRechazos] = useState<string[]>([]);

  const agregar = (lista: FileList | File[]) => {
    const ok: File[] = [];
    const malos: string[] = [];
    for (const f of Array.from(lista)) {
      if (!mimeAceptado(f.type, f.name)) malos.push(`${f.name}: tipo no permitido`);
      else if (f.size > ARCHIVO_MAX_BYTES) malos.push(`${f.name}: supera ${tamanoLegible(ARCHIVO_MAX_BYTES)}`);
      else if (f.size === 0) malos.push(`${f.name}: está vacío`);
      else ok.push(f);
    }
    setRechazos(malos);
    if (ok.length) onCambio([...archivos, ...ok].slice(0, 20));
  };

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={deshabilitada ? -1 : 0}
        aria-disabled={deshabilitada}
        onClick={() => !deshabilitada && input.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !deshabilitada) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!deshabilitada) setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSobre(false);
          if (!deshabilitada && e.dataTransfer.files.length) agregar(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition ${
          compacta ? "px-4 py-4" : "px-4 py-8"
        } ${sobre ? "scale-[1.01] border-[#4FAEB2] bg-[#4FAEB2]/10" : "border-[#4FAEB2]/30 bg-gradient-to-br from-[#4FAEB2]/[0.05] to-sky-50/50 hover:border-[#4FAEB2]/60"} ${
          deshabilitada ? "cursor-not-allowed opacity-60" : ""
        }`}
      >
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-[#4FAEB2] shadow-[0_6px_16px_-8px_rgba(79,174,178,0.8)]">
          <UploadCloud className="h-5 w-5" aria-hidden />
        </span>
        <p className="mt-2 text-[13px] font-semibold text-slate-700">Arrastrá archivos aquí o <span className="text-[#2F6E71] underline decoration-[#4FAEB2]/40 underline-offset-2">elegilos</span></p>
        <p className="mt-0.5 text-[11.5px] text-slate-400">
          PNG, JPG, WEBP, PDF, MP4, MOV, TXT (máx. {tamanoLegible(ARCHIVO_MAX_BYTES)} c/u)
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ARCHIVO_EXTENSIONES}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) agregar(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {rechazos.length ? (
        <ul className="space-y-0.5 text-[12px] text-rose-600">
          {rechazos.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}

      {archivos.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {archivos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
              <span className="text-slate-400">
                <IconoArchivo tipo={f.type} />
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-700">{f.name}</span>
              <span className="shrink-0 tabular-nums text-[12px] text-slate-400">{tamanoLegible(f.size)}</span>
              <button
                type="button"
                onClick={() => onCambio(archivos.filter((_, j) => j !== i))}
                disabled={deshabilitada}
                aria-label={`Quitar ${f.name}`}
                className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
