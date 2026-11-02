"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Send, Loader2, Paperclip, Mic, Smile, Zap, X, Square, Trash2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { pickRecorderMimeType, extForAudioType } from "@/lib/chat/audio-recording";
import { listActiveQuickRepliesForQueue } from "@/lib/chat/quick-replies-actions";

/** Emojis de uso frecuente, agrupados. Mismo set que el inbox (versión compacta). */
const EMOJI_GRUPOS: { grupo: string; items: string[] }[] = [
  { grupo: "Caras", items: ["😀","😃","😄","😁","😊","🙂","😉","😍","🥰","😘","😂","🤣","😅","😎","🤩","🥳","🤔","😌","😴","😢","😭","😡","😱","🥺","🙄","😬"] },
  { grupo: "Gestos", items: ["👍","👎","👌","🙌","👏","🙏","💪","🤝","👋","✌️","🤞","☝️","👉","👈","✋","🤙"] },
  { grupo: "Símbolos", items: ["❤️","🧡","💚","💙","💜","🔥","⭐","✨","✅","❌","⚠️","❓","❗","💯","🎉","🎁"] },
  { grupo: "Trabajo", items: ["📌","📎","📅","⏰","💰","💳","🧾","📞","📧","📦","🚀","📲","💻","📝","🔎","🏷️"] },
];

/** mm:ss para el contador de grabación. */
function formatRecordTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type QuickReply = { id: string; title: string; body: string };

/**
 * Compositor del modal de Finalizadas: escribir al contacto sin salir de la pantalla.
 * Texto + adjuntar archivo + nota de voz + emojis + respuestas rápidas (SIN plantillas).
 * Envía por la conversación existente del cierre; el backend resuelve el canal real.
 */
export function FinalizedComposer({
  conversationId,
  queueId,
  onSent,
}: {
  conversationId: string;
  queueId: string | null;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrLoaded, setQrLoaded] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [pendingVoice, setPendingVoice] = useState<{ file: File; url: string } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discardRef = useRef(false);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const qrPanelRef = useRef<HTMLDivElement>(null);

  const busy = sending || uploading || recording;

  // Limpieza al desmontar: cortar grabación en curso y liberar el preview de audio.
  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pendingVoice) URL.revokeObjectURL(pendingVoice.url);
    };
  }, [pendingVoice]);

  // Cerrar los paneles (emoji / respuestas) al clic fuera.
  useEffect(() => {
    if (!emojiOpen && !qrOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (emojiOpen && emojiPanelRef.current && !emojiPanelRef.current.contains(t)) setEmojiOpen(false);
      if (qrOpen && qrPanelRef.current && !qrPanelRef.current.contains(t)) setQrOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [emojiOpen, qrOpen]);

  const insertAtCursor = useCallback((fragmento: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => prev + fragmento);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setText((prev) => prev.slice(0, start) + fragmento + prev.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + fragmento.length;
      el.setSelectionRange(pos, pos);
    });
  }, []);

  const abrirQuickReplies = useCallback(() => {
    setEmojiOpen(false);
    setQrOpen((v) => !v);
    if (qrLoaded || !queueId) return;
    setQrLoading(true);
    void listActiveQuickRepliesForQueue(queueId)
      .then((rows) => {
        setQuickReplies(rows.map((r) => ({ id: r.id, title: r.title, body: r.body })));
        setQrLoaded(true);
      })
      .catch(() => setQuickReplies([]))
      .finally(() => setQrLoading(false));
  }, [queueId, qrLoaded]);

  const enviarTexto = useCallback(async () => {
    const texto = text.trim();
    if (!texto) {
      setErr("Escribí un mensaje.");
      return;
    }
    setSending(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetchWithSupabaseSession("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message: texto }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setErr(json?.error || "No se pudo enviar el mensaje.");
        return;
      }
      setText("");
      setOk("Mensaje enviado.");
      onSent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red al enviar.");
    } finally {
      setSending(false);
    }
  }, [text, conversationId, onSent]);

  const enviarArchivo = useCallback(
    async (file: File) => {
      if (!file || file.size < 1) return;
      setUploading(true);
      setErr(null);
      setOk(null);
      try {
        const fd = new FormData();
        fd.set("conversation_id", conversationId);
        fd.set("file", file);
        const res = await fetchWithSupabaseSession("/api/chat/send-media", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          setErr(typeof json.error === "string" ? json.error : `Error HTTP ${res.status}`);
          return;
        }
        setOk("Archivo enviado.");
        onSent();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error al enviar archivo.");
      } finally {
        setUploading(false);
      }
    },
    [conversationId, onSent]
  );

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reelegir el mismo archivo
    if (file) void enviarArchivo(file);
  }

  function stopRecordTimer() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  function descartarVoz() {
    setPendingVoice((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  async function iniciarGrabacion() {
    if (busy || pendingVoice) return;
    setErr(null);
    setOk(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordChunksRef.current = [];
      discardRef.current = false;
      const mime = pickRecorderMimeType();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current = null;
        streamRef.current = null;
        stopRecordTimer();
        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || "audio/webm" });
        recordChunksRef.current = [];
        setRecording(false);
        const descartada = discardRef.current;
        discardRef.current = false;
        if (descartada || blob.size < 300) return;
        const ext = extForAudioType(blob.type);
        const voiceFile = new File([blob], `nota-voz.${ext}`, { type: blob.type || "audio/webm" });
        setPendingVoice({ file: voiceFile, url: URL.createObjectURL(voiceFile) });
      };
      setRecordSeconds(0);
      setRecording(true);
      stopRecordTimer();
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      rec.start();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo acceder al micrófono.");
      setRecording(false);
      stopRecordTimer();
    }
  }

  function detenerGrabacion() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") {
      discardRef.current = false;
      mr.stop();
    }
  }

  function cancelarGrabacion() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") {
      discardRef.current = true;
      mr.stop();
    }
  }

  const enviarVozPendiente = useCallback(async () => {
    if (!pendingVoice) return;
    const file = pendingVoice.file;
    await enviarArchivo(file);
    descartarVoz();
  }, [pendingVoice, enviarArchivo]);

  // Botón principal: si hay nota de voz en preview la manda; si no, manda el texto.
  const enviarPrincipal = useCallback(() => {
    if (pendingVoice) return void enviarVozPendiente();
    void enviarTexto();
  }, [pendingVoice, enviarVozPendiente, enviarTexto]);

  // Grabando: solo el contador con detener/cancelar.
  if (recording) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-rose-700">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
          Grabando… {formatRecordTime(recordSeconds)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={cancelarGrabacion}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Trash2 className="h-4 w-4" /> Cancelar
          </button>
          <button
            type="button"
            onClick={detenerGrabacion}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#3F8E91]"
          >
            <Square className="h-4 w-4" /> Listo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {ok && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{ok}</p>
      )}
      {err && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800">{err}</p>
      )}

      {/* Nota de voz grabada, esperando confirmación. */}
      {pendingVoice && (
        <div className="flex items-center gap-3 rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 px-3 py-2">
          <Mic className="h-4 w-4 shrink-0 text-[#3F8E91]" aria-hidden />
          <audio controls src={pendingVoice.url} className="h-9 min-w-0 flex-1" />
          <button
            type="button"
            onClick={descartarVoz}
            disabled={uploading}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-rose-600 disabled:opacity-50"
            aria-label="Descartar nota de voz"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Barra de acciones */}
        <div className="flex items-center gap-1">
          <input ref={fileInputRef} type="file" className="hidden" onChange={onPickFile} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || Boolean(pendingVoice)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-[#3F8E91] disabled:opacity-40"
            title="Adjuntar archivo"
            aria-label="Adjuntar archivo"
          >
            <Paperclip className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void iniciarGrabacion()}
            disabled={busy || Boolean(pendingVoice)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-[#3F8E91] disabled:opacity-40"
            title="Grabar nota de voz"
            aria-label="Grabar nota de voz"
          >
            <Mic className="h-[18px] w-[18px]" aria-hidden />
          </button>

          {/* Emojis */}
          <div ref={emojiPanelRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setQrOpen(false);
                setEmojiOpen((v) => !v);
              }}
              disabled={busy}
              className={`rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40 ${
                emojiOpen ? "text-[#3F8E91]" : "text-slate-500 hover:text-[#3F8E91]"
              }`}
              title="Insertar emoji"
              aria-label="Insertar emoji"
              aria-expanded={emojiOpen}
            >
              <Smile className="h-[18px] w-[18px]" aria-hidden />
            </button>
            {emojiOpen && (
              <div className="absolute bottom-full left-0 z-[90] mb-2 max-h-64 w-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                {EMOJI_GRUPOS.map((g) => (
                  <div key={g.grupo} className="mb-2 last:mb-0">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{g.grupo}</p>
                    <div className="grid grid-cols-8 gap-0.5">
                      {g.items.map((emoji, i) => (
                        <button
                          key={`${emoji}-${i}`}
                          type="button"
                          onClick={() => insertAtCursor(emoji)}
                          className="rounded-lg p-1 text-lg hover:bg-slate-100"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Respuestas rápidas */}
          <div ref={qrPanelRef} className="relative">
            <button
              type="button"
              onClick={abrirQuickReplies}
              disabled={busy || !queueId}
              className={`rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40 ${
                qrOpen ? "text-[#3F8E91]" : "text-slate-500 hover:text-[#3F8E91]"
              }`}
              title="Respuestas rápidas"
              aria-label="Respuestas rápidas"
              aria-expanded={qrOpen}
            >
              <Zap className="h-[18px] w-[18px]" aria-hidden />
            </button>
            {qrOpen && (
              <div className="absolute bottom-full left-0 z-[90] mb-2 max-h-64 w-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                {qrLoading ? (
                  <p className="px-2 py-3 text-sm text-slate-400">Cargando…</p>
                ) : quickReplies.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-slate-500">
                    No hay respuestas rápidas para esta cola.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {quickReplies.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            insertAtCursor(r.body);
                            setQrOpen(false);
                          }}
                          className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-[#4FAEB2]/10"
                        >
                          <span className="block text-[13px] font-semibold text-slate-800">{r.title}</span>
                          <span className="block truncate text-xs text-slate-500">{r.body}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          disabled={uploading || sending}
          placeholder={pendingVoice ? "Nota de voz lista para enviar" : "Escribí tu mensaje…"}
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] disabled:bg-slate-50"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !busy) {
              e.preventDefault();
              enviarPrincipal();
            }
          }}
        />

        <button
          type="button"
          onClick={enviarPrincipal}
          disabled={busy || (!pendingVoice && !text.trim())}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60"
        >
          {sending || uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending || uploading ? "Enviando…" : "Enviar"}
        </button>
      </div>

      <p className="text-[11px] text-slate-400">Enter envía · Shift+Enter salto de línea</p>
    </div>
  );
}
