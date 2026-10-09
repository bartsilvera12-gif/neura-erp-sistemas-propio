"use client";

import { useMemo, useState } from "react";
import { X, Send, Loader2, UserPlus } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { ChatChannelRow } from "@/lib/chat/actions";

/**
 * Modal "Nuevo mensaje": el asesor escribe a una persona nueva (o existente) desde el ERP.
 * Crea/reusa la conversación (POST /api/chat/conversations/start), envía el primer mensaje
 * (POST /api/chat/send) y abre la conversación en el inbox. La conversación queda asignada
 * al asesor que la inicia (lo resuelve el backend).
 */
export function NuevoMensajeModal({
  channels,
  onClose,
  onCreated,
}: {
  channels: ChatChannelRow[];
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const waChannels = useMemo(
    () => channels.filter((c) => (c.type ?? "whatsapp") === "whatsapp"),
    [channels]
  );
  // Por defecto el canal comercial (WhatsApp por QR / Baileys) si existe; si no, el primero.
  const [channelId, setChannelId] = useState<string>(() => {
    const bail = waChannels.find((c) => c.provider === "baileys");
    return (bail ?? waChannels[0])?.id ?? "";
  });
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!channelId) return setErr("Elegí un canal.");
    if (!phone.trim()) return setErr("Ingresá el número.");
    if (!message.trim()) return setErr("Escribí el mensaje.");
    setSending(true);
    try {
      // 1) Crear/reusar la conversación.
      const r1 = await fetchWithSupabaseSession("/api/chat/conversations/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, phone: phone.trim(), name: name.trim() || undefined }),
      });
      const j1 = (await r1.json().catch(() => null)) as
        | { ok?: boolean; conversation_id?: string; error?: string }
        | null;
      if (!r1.ok || !j1?.ok || !j1.conversation_id) {
        setErr(j1?.error || "No se pudo iniciar la conversación.");
        setSending(false);
        return;
      }
      const convId = j1.conversation_id;

      // 2) Enviar el primer mensaje por el flujo normal.
      const r2 = await fetchWithSupabaseSession("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: convId, message: message.trim() }),
      });
      const j2 = (await r2.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r2.ok || !j2?.ok) {
        // La conversación quedó creada; abrimos igual para que reintente desde el chat.
        setErr(j2?.error || "La conversación se creó pero el mensaje no salió. Reintentá desde el chat.");
        onCreated(convId);
        setSending(false);
        return;
      }

      onCreated(convId);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error inesperado.");
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4FAEB2]/12 text-[#3F8E91]">
              <UserPlus className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-bold text-slate-900">Nuevo mensaje</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {waChannels.length > 1 && (
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Canal</span>
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
              >
                {waChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.nombre ?? "").trim() || "WhatsApp"}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Número (con código de país)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="Ej. 595981234567"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-[#4FAEB2]"
            />
            <span className="mt-1 block text-[11px] text-slate-400">
              Si es de Paraguay podés poner 0981… y se completa solo.
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Nombre (opcional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cómo aparece en el inbox"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Mensaje</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Escribí el primer mensaje…"
              className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !sending) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </label>

          {err && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {err}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
