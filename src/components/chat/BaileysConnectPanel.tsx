"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBaileysChannelStatus, type BaileysChannelStatus } from "@/lib/chat/actions";

/**
 * Panel de conexión / RECONEXIÓN de un canal WhatsApp por QR (Baileys) YA EXISTENTE.
 *
 * A diferencia del wizard de alta (`WhatsAppQrConnect`, que crea el canal), este panel
 * trabaja contra un `channelId` que ya está en la base: hace polling a
 * `getBaileysChannelStatus` y muestra el estado (conectado / QR para escanear / esperando).
 * Es la pantalla que usa el equipo para volver a vincular el número si el puente se cae o
 * si cierran la sesión desde el celular.
 */
export function BaileysConnectPanel({ channelId }: { channelId: string }) {
  const [status, setStatus] = useState<BaileysChannelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = useCallback(async () => {
    try {
      const s = await getBaileysChannelStatus(channelId);
      setStatus(s);
    } catch {
      /* el próximo tick reintenta */
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;
    void tick();
    pollRef.current = setInterval(() => void tick(), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [channelId, tick]);

  // Al conectarse, dejamos de pollear tan seguido (una verificación esporádica alcanza).
  useEffect(() => {
    if (status?.connection === "open" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = setInterval(() => void tick(), 15000);
    }
  }, [status?.connection, tick]);

  const connection = status?.connection ?? "starting";
  const connected = connection === "open";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">WhatsApp por QR (número propio)</p>
        <p className="mt-1 text-sm text-emerald-950">
          Este canal se conecta escaneando un QR desde el celular del número, como WhatsApp Web.
        </p>
        <p className="mt-1 text-xs text-emerald-900/80">
          Si el número se desconecta (se cae el puente o cierran la sesión desde el celu), volvé a
          esta pantalla y escaneá el QR de nuevo. El celular sigue funcionando normal.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        {loading && !status ? (
          <div className="text-center">
            <div className="mx-auto h-56 w-56 animate-pulse rounded-lg bg-slate-100" />
            <p className="mt-4 text-sm font-semibold text-slate-700">Consultando estado del puente…</p>
          </div>
        ) : connected ? (
          <div className="text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-2 text-lg font-bold text-slate-900">Conectado</p>
            {status?.meNumber && <p className="mt-1 font-mono text-xs text-slate-500">{status.meNumber}</p>}
            <p className="mt-2 text-sm text-slate-600">
              El número está vinculado. Los chats entran y se responden desde el inbox.
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Para desvincular: en el celular → WhatsApp → Dispositivos vinculados → cerrar la sesión.
            </p>
          </div>
        ) : status?.qrDataUrl ? (
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">Escaneá este QR desde el celular del número</p>
            <p className="text-xs text-slate-500">WhatsApp → Dispositivos vinculados → Vincular un dispositivo</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={status.qrDataUrl}
              alt="Código QR para vincular WhatsApp"
              className="mx-auto mt-4 h-56 w-56 rounded-lg border border-slate-200"
            />
            <p className="mt-3 text-xs text-slate-400">El QR se refresca solo. Esta pantalla detecta la conexión.</p>
          </div>
        ) : (
          <div className="text-center">
            <div className="mx-auto h-56 w-56 animate-pulse rounded-lg bg-slate-100" />
            <p className="mt-4 text-sm font-semibold text-slate-700">
              {connection === "close" ? "Puente desconectado" : "Esperando al puente…"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {status?.error
                ? status.error
                : "Cuando el puente esté encendido y listo, acá va a aparecer el QR para vincular."}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">
          Estado:{" "}
          <span className="font-mono">
            {connected ? "conectado" : connection === "qr" ? "esperando escaneo" : connection}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void tick()}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Actualizar ahora
        </button>
      </div>
    </div>
  );
}
