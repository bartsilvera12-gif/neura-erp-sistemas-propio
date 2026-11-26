"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw, Send, X } from "lucide-react";

/**
 * Sacar una foto con la cámara de la computadora y adjuntarla al mensaje.
 *
 * En el celular no se usa: ahí el input con `capture` abre la cámara del
 * teléfono, que es mejor que cualquier cosa armada a mano.
 */
export default function CamaraModal({
  onCerrar,
  onFoto,
}: {
  onCerrar: () => void;
  onFoto: (f: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState(false);
  const [foto, setFoto] = useState<{ url: string; blob: Blob } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!vivo) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => {});
        }
        setLista(true);
      } catch {
        setError("No se pudo abrir la cámara. Revisá que el navegador tenga permiso para usarla.");
      }
    })();
    return () => {
      vivo = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => () => {
    if (foto) URL.revokeObjectURL(foto.url);
  }, [foto]);

  function sacar() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob(
      (b) => {
        if (b) setFoto({ url: URL.createObjectURL(b), blob: b });
      },
      "image/jpeg",
      0.9
    );
  }

  function usar() {
    if (!foto) return;
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const nombre = `foto-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
    onFoto(new File([foto.blob], nombre, { type: "image/jpeg" }));
    onCerrar();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 p-4" onMouseDown={onCerrar}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-slate-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 text-white">
          <span className="text-[15px] font-semibold">Tomar foto</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-lg p-1 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative flex aspect-video items-center justify-center bg-black">
          {error ? (
            <p className="max-w-sm px-6 text-center text-[14px] text-slate-300">{error}</p>
          ) : (
            <>
              <video
                ref={videoRef}
                muted
                playsInline
                className={`h-full w-full -scale-x-100 object-contain ${foto ? "hidden" : ""}`}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {foto ? <img src={foto.url} alt="Foto tomada" className="h-full w-full object-contain" /> : null}
              {!lista ? <Loader2 className="absolute h-8 w-8 animate-spin text-slate-400" /> : null}
            </>
          )}
        </div>
        <div className="flex items-center justify-center gap-4 px-4 py-4">
          {foto ? (
            <>
              <button
                type="button"
                onClick={() => setFoto(null)}
                className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[14px] font-medium text-white hover:bg-white/20"
              >
                <RotateCcw className="h-4 w-4" /> Repetir
              </button>
              <button
                type="button"
                onClick={usar}
                className="flex items-center gap-2 rounded-full bg-[#4FAEB2] px-5 py-2 text-[14px] font-semibold text-white hover:bg-[#3F8E91]"
              >
                <Send className="h-4 w-4" /> Adjuntar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={sacar}
              disabled={!lista}
              aria-label="Sacar foto"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-800 ring-4 ring-white/30 transition-transform hover:scale-105 disabled:opacity-40"
            >
              <Camera className="h-6 w-6" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
