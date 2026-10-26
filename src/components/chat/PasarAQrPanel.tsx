"use client";

import { useState } from "react";
import { pasarCanalWhatsappAQr } from "@/lib/chat/actions";

/**
 * Pasa un canal de WhatsApp de la API oficial a conectarse por QR.
 *
 * Hasta ahora este cambio no existía en ninguna pantalla: el formulario de WhatsApp solo
 * ofrece Meta y YCloud, y el panel para escanear el QR aparece únicamente cuando el canal
 * YA está en QR. Para arrancar había que entrar a la base a mano.
 *
 * Va plegado y con la advertencia a la vista a propósito: el paso de verdad irreversible
 * —dar de baja el número en Meta— pasa afuera del ERP, pero conviene no ofrecer el botón
 * como si fuera un cambio cualquiera.
 */
export default function PasarAQrPanel({
  channelId,
  onListo,
}: {
  channelId: string;
  onListo?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [url, setUrl] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pasar() {
    setGuardando(true);
    setError(null);
    try {
      await pasarCanalWhatsappAQr({ channelId, bridgeUrl: url });
      onListo?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el canal");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-sm font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
      >
        Conectar este número por QR en vez de la API oficial
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <p className="text-[13px] font-semibold text-amber-900">Conectar por QR</p>
      <p className="text-[12.5px] leading-relaxed text-amber-900/80">
        El número deja de usar la API oficial y pasa a conectarse escaneando un QR, como
        WhatsApp Web. <strong>Antes de seguir, el número tiene que estar dado de baja en Meta
        o YCloud</strong>: no puede estar en los dos lados a la vez. Las plantillas y las
        campañas dejan de funcionar en este canal.
      </p>
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          URL del puente
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://baileys-contable.neura.com.py"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
        />
      </div>
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          disabled={guardando}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void pasar()}
          disabled={guardando || !url.trim()}
          className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {guardando ? "Cambiando…" : "Pasar a QR"}
        </button>
      </div>
      <p className="text-[12px] text-amber-900/70">
        Después de esto, acá mismo va a aparecer el QR para escanear desde el celular.
      </p>
    </div>
  );
}
