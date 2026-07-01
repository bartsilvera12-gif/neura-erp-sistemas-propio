"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  getErpAttachmentPublicUrl,
  getWhatsAppMediaUrlFromRawPayload,
} from "@/lib/chat/message-erp-display";

type Msg = {
  id: string;
  from_me: boolean;
  sender_type: string | null;
  content: string;
  message_type: string;
  created_at: string | null;
  raw_payload?: Record<string, unknown> | null;
};

type Pending = {
  tempId: string;
  status: "sending" | "error";
  kind: "text" | "audio";
  content: string;
  file?: File;
};

const EMOJIS = [
  "😀", "😅", "😂", "🙂", "😉", "😊", "😍", "🙌", "👍", "👌",
  "🙏", "💪", "🔥", "✅", "❤️", "🎉", "🤝", "👋", "📌", "⏰",
];

/** URL reproducible del adjunto (bucket público chat-media o media de WhatsApp). Mismo criterio que desktop. */
function mediaUrl(m: Msg): string | null {
  const raw = (m.raw_payload ?? null) as Parameters<typeof getErpAttachmentPublicUrl>[0];
  return getErpAttachmentPublicUrl(raw) ?? getWhatsAppMediaUrlFromRawPayload(raw) ?? null;
}

function fmtSecs(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function MessageBody({ m }: { m: Msg }) {
  if (m.message_type === "text") {
    return <span className="whitespace-pre-wrap break-words">{m.content}</span>;
  }
  const url = mediaUrl(m);
  if (m.message_type === "audio") {
    return url ? (
      <audio controls src={url} preload="metadata" className="h-9 w-56 max-w-full" />
    ) : (
      <span className="italic opacity-80">[audio]</span>
    );
  }
  if (m.message_type === "image") {
    return url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="imagen" className="max-w-[220px] rounded-lg" />
    ) : (
      <span className="italic opacity-80">[imagen]</span>
    );
  }
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="break-all underline">
      [{m.message_type}]
    </a>
  ) : (
    <span className="italic opacity-80">[{m.message_type}]</span>
  );
}

export default function MAsesorChatPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = (params?.conversationId as string) ?? "";
  const router = useRouter();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [title, setTitle] = useState("Chat");
  const [windowOpen, setWindowOpen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRecRef = useRef(false);
  const recTimerRef = useRef<number | null>(null);

  const load = useCallback(
    async (silent?: boolean) => {
      if (!conversationId) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetchWithSupabaseSession(
          `/api/mobile/asesor/conversations/${conversationId}`,
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setErr("No tenés acceso a esta conversación.");
          return;
        }
        if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo cargar");
        setMessages((data.messages ?? []) as Msg[]);
        setTitle(data.conversation?.contact_nombre || data.conversation?.contact_telefono || "Chat");
        setWindowOpen(data.conversation?.window_open ?? null);
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(true), 12000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  // Autogrow del textarea (multilínea sin romper el layout).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  // Detección de soporte de grabación (client-only, evita mostrar un botón inútil).
  useEffect(() => {
    setMicSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined"
    );
  }, []);

  // Limpieza: cortar grabación/stream/timer al desmontar.
  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recTimerRef.current) window.clearInterval(recTimerRef.current);
    };
  }, []);

  // ── Envío de texto (optimista, no bloqueante) ──────────────────────────────
  const deliverText = useCallback(
    (tempId: string, msg: string) => {
      void (async () => {
        try {
          const res = await fetchWithSupabaseSession(
            `/api/mobile/asesor/conversations/${conversationId}/send`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ message: msg }),
            }
          );
          const data = await res.json().catch(() => ({}));
          if (res.status === 409 || data?.code === "whatsapp_window_closed") {
            setWindowOpen(false);
            setSendErr(
              data?.error ||
                "La ventana de 24 h de WhatsApp está cerrada. Para reabrir hay que enviar una plantilla aprobada."
            );
            setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, status: "error" } : x)));
            return;
          }
          if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo enviar");
          await load(true);
          setPending((p) => p.filter((x) => x.tempId !== tempId));
        } catch (e) {
          setSendErr(e instanceof Error ? e.message : "Error al enviar");
          setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, status: "error" } : x)));
        }
      })();
    },
    [conversationId, load]
  );

  // ── Envío de audio (optimista, no bloqueante) ──────────────────────────────
  const deliverAudio = useCallback(
    (tempId: string, file: File) => {
      void (async () => {
        try {
          const fd = new FormData();
          fd.set("file", file, file.name || "nota-voz.webm");
          const res = await fetchWithSupabaseSession(
            `/api/mobile/asesor/conversations/${conversationId}/send-media`,
            { method: "POST", body: fd }
          );
          const data = await res.json().catch(() => ({}));
          if (res.status === 409 || data?.code === "whatsapp_window_closed") {
            setWindowOpen(false);
            setSendErr(
              data?.error ||
                "La ventana de 24 h de WhatsApp está cerrada. Para reabrir hay que enviar una plantilla aprobada."
            );
            setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, status: "error" } : x)));
            return;
          }
          if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo enviar el audio");
          await load(true);
          setPending((p) => p.filter((x) => x.tempId !== tempId));
        } catch (e) {
          setSendErr(e instanceof Error ? e.message : "Error al enviar el audio");
          setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, status: "error" } : x)));
        }
      })();
    },
    [conversationId, load]
  );

  const send = useCallback(() => {
    const msg = text.trim();
    if (!msg) return;
    const tempId = `tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    setText("");
    setShowEmoji(false);
    setSendErr(null);
    setPending((p) => [...p, { tempId, kind: "text", content: msg, status: "sending" }]);
    deliverText(tempId, msg);
  }, [text, deliverText]);

  const sendAudio = useCallback(
    (file: File) => {
      const tempId = `tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      setSendErr(null);
      setPending((p) => [...p, { tempId, kind: "audio", content: "Nota de voz", file, status: "sending" }]);
      deliverAudio(tempId, file);
    },
    [deliverAudio]
  );

  const retry = useCallback(
    (item: Pending) => {
      setSendErr(null);
      setPending((p) => p.map((x) => (x.tempId === item.tempId ? { ...x, status: "sending" } : x)));
      if (item.kind === "audio" && item.file) deliverAudio(item.tempId, item.file);
      else deliverText(item.tempId, item.content);
    },
    [deliverAudio, deliverText]
  );

  // ── Grabación de nota de voz ────────────────────────────────────────────────
  const startRec = useCallback(async () => {
    setSendErr(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setSendErr("No se pudo acceder al micrófono");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelRecRef.current = false;
      const mime =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current = null;
        streamRef.current = null;
        if (recTimerRef.current) {
          window.clearInterval(recTimerRef.current);
          recTimerRef.current = null;
        }
        setRecording(false);
        setRecSecs(0);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (cancelRecRef.current || blob.size < 300) return;
        const ext = blob.type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `nota-voz.${ext}`, { type: blob.type || "audio/webm" });
        sendAudio(file);
      };
      setRecording(true);
      setRecSecs(0);
      recTimerRef.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
      rec.start(400);
    } catch {
      setSendErr("No se pudo acceder al micrófono");
      setRecording(false);
    }
  }, [sendAudio]);

  const stopAndSend = useCallback(() => {
    cancelRecRef.current = false;
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  const cancelRec = useCallback(() => {
    cancelRecRef.current = true;
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  return (
    <div className="min-h-svh max-h-svh bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-[#3F8E91] text-white px-2 py-2.5 shadow-sm flex items-center gap-2">
        <button onClick={() => router.push("/m/asesor")} aria-label="Volver" className="h-9 w-9 grid place-items-center rounded-full active:bg-white/15 text-lg">
          ‹
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight">{title}</h1>
          <p className="text-[11px] text-white/80 leading-tight">
            {windowOpen === false ? "Ventana 24 h cerrada" : windowOpen === true ? "Ventana 24 h abierta" : "WhatsApp"}
          </p>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading ? (
          <div className="text-center text-slate-400 text-sm animate-pulse py-6">Cargando…</div>
        ) : err ? (
          <div className="m-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">{err}</div>
        ) : messages.length === 0 && pending.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-6">Sin mensajes.</div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3 py-2 text-[14px] leading-snug shadow-sm ${
                    m.from_me ? "bg-[#4FAEB2] text-white rounded-br-md" : "bg-white text-slate-800 border border-slate-100 rounded-bl-md"
                  }`}
                >
                  <MessageBody m={m} />
                </div>
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.tempId} className="flex justify-end">
                <div className="max-w-[78%] rounded-2xl rounded-br-md bg-[#4FAEB2]/70 text-white px-3 py-2 text-[14px] leading-snug shadow-sm">
                  <span className="whitespace-pre-wrap break-words">
                    {p.kind === "audio" ? "🎤 Nota de voz" : p.content}
                  </span>
                  <div className="mt-0.5 text-[10px] text-white/85">
                    {p.status === "sending" ? (
                      "enviando…"
                    ) : (
                      <button type="button" onClick={() => retry(p)} className="underline">
                        error · reintentar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {windowOpen === false ? (
        <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-amber-800 text-[12px]">
          Ventana de 24 h cerrada: para reabrir el chat hay que enviar una plantilla aprobada (recontacto).
        </div>
      ) : null}
      {sendErr ? <div className="px-3 py-1.5 bg-red-50 text-red-700 text-[12px]">{sendErr}</div> : null}

      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-2 py-2">
        {recording ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelRec}
              className="shrink-0 h-10 px-3 rounded-2xl border border-slate-200 text-slate-600 text-sm font-semibold active:scale-95"
            >
              Cancelar
            </button>
            <div className="flex-1 flex items-center gap-2 text-red-600 text-sm font-medium">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              Grabando {fmtSecs(recSecs)}
            </div>
            <button
              type="button"
              onClick={stopAndSend}
              className="shrink-0 h-10 px-4 rounded-2xl bg-[#3F8E91] text-white text-sm font-semibold active:scale-95"
            >
              Enviar
            </button>
          </div>
        ) : (
          <>
            {showEmoji ? (
              <div className="mb-2 flex flex-wrap gap-1 px-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setText((t) => t + e)}
                    className="p-1 text-xl leading-none active:scale-90"
                    aria-label={`Emoji ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                aria-label="Emojis"
                className="shrink-0 h-10 w-10 grid place-items-center rounded-full text-xl active:bg-slate-100"
              >
                😊
              </button>
              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={1}
                placeholder="Escribí un mensaje…"
                className="flex-1 resize-none rounded-2xl border border-slate-200 px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40 max-h-32"
              />
              {text.trim() ? (
                <button
                  onClick={send}
                  className="shrink-0 h-10 px-4 rounded-2xl bg-[#3F8E91] text-white text-sm font-semibold active:scale-95 transition"
                >
                  Enviar
                </button>
              ) : micSupported ? (
                <button
                  type="button"
                  onClick={() => void startRec()}
                  aria-label="Grabar nota de voz"
                  className="shrink-0 h-10 w-10 grid place-items-center rounded-full bg-[#3F8E91] text-white text-lg active:scale-95 transition"
                >
                  🎤
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
