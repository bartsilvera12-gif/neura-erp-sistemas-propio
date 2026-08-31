"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  saveBaileysWhatsappChannel,
  getBaileysChannelStatus,
  type BaileysChannelStatus,
} from "@/lib/chat/actions";

type Step = "form" | "connect";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate font-mono text-xs text-slate-800">{value || "—"}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* noop */
          }
        }}
        className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
      >
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

export function WhatsAppQrConnect({
  cancelHref,
  onSaved,
}: {
  cancelHref: string;
  onSaved: (id: string) => void;
}) {
  const [step, setStep] = useState<Step>("form");
  const [nombre, setNombre] = useState("WhatsApp por QR");
  const [bridgeUrl, setBridgeUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [channelId, setChannelId] = useState<string>("");
  const [status, setStatus] = useState<BaileysChannelStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const submit = useCallback(async () => {
    setFormError(null);
    const url = bridgeUrl.trim();
    if (!url) {
      setFormError("Ingresá la URL del puente.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setFormError("La URL debe empezar con http:// o https://");
      return;
    }
    setSaving(true);
    try {
      const id = await saveBaileysWhatsappChannel({ nombre, bridge_url: url });
      setChannelId(id);
      setStep("connect");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No se pudo crear el canal.");
    } finally {
      setSaving(false);
    }
  }, [nombre, bridgeUrl]);

  useEffect(() => {
    if (step !== "connect" || !channelId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getBaileysChannelStatus(channelId);
        if (!cancelled) setStatus(s);
      } catch {
        /* el próximo tick reintenta */
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [step, channelId]);

  useEffect(() => {
    if (status?.connection === "open" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [status?.connection]);

  if (step === "form") {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Tipo de conexión</p>
          <p className="text-sm font-semibold text-emerald-950">WhatsApp por QR (número propio)</p>
          <p className="mt-1 text-xs text-emerald-900/80">
            Vinculás tu número escaneando un QR (como WhatsApp Web). La conexión la mantiene el
            &quot;puente&quot; (servicio externo). Ideal para atención 1:1; no usar para campañas.
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Nombre del canal</span>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              placeholder="WhatsApp por QR"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">URL del puente</span>
            <input
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400"
              placeholder="https://wa-bridge.tudominio.com"
            />
            <span className="mt-1 block text-xs text-slate-500">
              La dirección del contenedor del puente (Coolify). El ERP la usa para mostrar el QR y enviar.
            </span>
          </label>

          {formError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {formError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "Creando…" : "Crear canal y continuar"}
            </button>
            <a href={cancelHref} className="text-sm font-semibold text-slate-500 hover:text-slate-800">
              Cancelar
            </a>
          </div>
        </div>
      </div>
    );
  }

  // step === "connect"
  const connection = status?.connection ?? "starting";
  const connected = connection === "open";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Paso 2 · Encendé el puente y escaneá</p>
        <p className="mt-1 text-sm text-slate-700">
          Poné estos dos valores en las variables del contenedor del puente en Coolify y encendelo:
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <CopyField label="ERP_CHANNEL_ID" value={channelId} />
          <CopyField label="ERP_EMPRESA_ID" value={status?.empresaId ?? ""} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        {connected ? (
          <div className="text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-2 text-lg font-bold text-slate-900">¡Conectado!</p>
            {status?.meNumber && (
              <p className="mt-1 font-mono text-xs text-slate-500">{status.meNumber}</p>
            )}
            <p className="mt-2 text-sm text-slate-600">
              Ya podés recibir y atender los chats de este número desde el inbox.
            </p>
            <button
              type="button"
              onClick={() => onSaved(channelId)}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Ir al canal
            </button>
          </div>
        ) : status?.qrDataUrl ? (
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">
              Escaneá este QR desde el celular del número
            </p>
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
            <p className="mt-4 text-sm font-semibold text-slate-700">Esperando al puente…</p>
            <p className="mt-1 text-xs text-slate-500">
              {status?.error
                ? status.error
                : "Cuando el contenedor esté encendido y configurado, acá va a aparecer el QR."}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <a href={cancelHref} className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          Volver a canales
        </a>
        <button
          type="button"
          onClick={() => onSaved(channelId)}
          className="text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          Ir al canal ahora
        </button>
      </div>
    </div>
  );
}
