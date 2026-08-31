"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  getErpAttachmentPublicUrl,
  getWhatsAppMediaUrlFromRawPayload,
} from "@/lib/chat/message-erp-display";
import { friendlyWhatsappFailureReason, extractWhatsappFailureInfo } from "@/lib/chat/whatsapp-failure-reason";
import { pickRecorderMimeType, extForAudioType } from "@/lib/chat/audio-recording";
import {
  extractBodyPlaceholderKeysOrdered,
  getBodyComponentText,
  PLACEHOLDER_RE,
} from "@/lib/campaigns/campaign-placeholders-shared";

type Msg = {
  id: string;
  /** ID del mensaje en WhatsApp; se usa para citarlo al responder. */
  wa_message_id?: string | null;
  from_me: boolean;
  sender_type: string | null;
  content: string;
  message_type: string;
  created_at: string | null;
  raw_payload?: Record<string, unknown> | null;
  whatsapp_delivery_status?: string | null;
};

type Pending = {
  tempId: string;
  status: "sending" | "error";
  kind: "text" | "audio" | "file";
  content: string;
  file?: File;
};

/** Raíz del mensaje dentro del raw_payload (envelope YCloud o Meta directo). */
function messageRoot(raw: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const wim = raw["whatsappInboundMessage"];
  if (wim && typeof wim === "object") return wim as Record<string, unknown>;
  const wm = raw["whatsappMessage"];
  if (wm && typeof wm === "object") return wm as Record<string, unknown>;
  return raw as Record<string, unknown>;
}

/** Contacto(s) compartido(s): nombre + teléfono. */
function extractContacts(raw: Record<string, unknown> | null | undefined): { name: string; phone: string }[] {
  const root = messageRoot(raw);
  const arr = root?.["contacts"];
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const nameObj = (o.name ?? {}) as Record<string, unknown>;
    const name =
      String(nameObj.formatted_name ?? nameObj.first_name ?? "").trim() || "Contacto";
    const phones = Array.isArray(o.phones) ? (o.phones as Record<string, unknown>[]) : [];
    const phone = String(phones[0]?.phone ?? phones[0]?.wa_id ?? "").trim();
    return { name, phone };
  });
}

/** Ubicación compartida: link a mapa + etiqueta. */
function extractLocation(
  raw: Record<string, unknown> | null | undefined
): { lat: number; lng: number; label: string } | null {
  const root = messageRoot(raw);
  const loc = root?.["location"];
  if (!loc || typeof loc !== "object") return null;
  const o = loc as Record<string, unknown>;
  const lat = Number(o.latitude);
  const lng = Number(o.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const label = String(o.name ?? o.address ?? "").trim();
  return { lat, lng, label };
}

type Tpl = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  components_json: unknown[];
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

/** Hora local del mensaje (HH:mm), como WhatsApp. created_at viene en UTC (timestamptz). */
function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Teléfono para mostrar en el header (dígitos → +5959...). */
function fmtPhone(p: string | null): string {
  if (!p) return "";
  const digits = p.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : p;
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
  if (m.message_type === "video") {
    return url ? (
      <video src={url} controls preload="metadata" className="max-w-[220px] rounded-lg" />
    ) : (
      <span className="italic opacity-80">[video]</span>
    );
  }
  if (m.message_type === "contacts") {
    const cs = extractContacts(m.raw_payload);
    if (cs.length === 0) return <span className="italic opacity-80">[contacto]</span>;
    return (
      <div className="space-y-1">
        {cs.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-sm">👤</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{c.name}</div>
              {c.phone ? (
                <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="text-[12px] underline break-all">
                  {c.phone}
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (m.message_type === "location") {
    const loc = extractLocation(m.raw_payload);
    if (!loc) return <span className="italic opacity-80">[ubicación]</span>;
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 underline"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-sm">📍</span>
        <span className="text-sm">{loc.label || "Ver ubicación en el mapa"}</span>
      </a>
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
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [windowOpen, setWindowOpen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sendErr, setSendErr] = useState<string | null>(null);
  /** Mensaje que se está citando (deslizá una burbuja hacia la derecha para elegirlo). */
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  /** Arrastre en curso: qué burbuja y cuántos px lleva. Sólo visual. */
  const [swipe, setSwipe] = useState<{ id: string; dx: number } | null>(null);
  const swipeStart = useRef<{ x: number; y: number; locked: boolean } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  // Recontacto con plantilla aprobada.
  const [tplOpen, setTplOpen] = useState(false);
  const [tplList, setTplList] = useState<Tpl[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplSelId, setTplSelId] = useState<string | null>(null);
  const [tplVars, setTplVars] = useState<Record<string, string>>({});
  const [tplSending, setTplSending] = useState(false);
  const [tplErr, setTplErr] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // ¿el usuario está abajo del todo? (si scrolleó a leer, false)
  const didInitialScrollRef = useRef(false); // ya hicimos el scroll-al-fondo inicial
  const lastMsgsSigRef = useRef(""); // firma de los mensajes para no re-render si no cambió nada
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        // Solo actualizamos si REALMENTE cambió algo (nuevos mensajes). Así el poll cada 12s no
        // re-renderiza ni dispara el scroll mientras el asesor lee tranquilo.
        const nuevos = (data.messages ?? []) as Msg[];
        const sig = `${nuevos.length}:${nuevos[nuevos.length - 1]?.id ?? ""}`;
        if (sig !== lastMsgsSigRef.current) {
          lastMsgsSigRef.current = sig;
          setMessages(nuevos);
        }
        setTitle(data.conversation?.contact_nombre || data.conversation?.contact_telefono || "Chat");
        setContactPhone(data.conversation?.contact_telefono ?? null);
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

  // Auto-scroll estilo WhatsApp: al fondo en la primera carga y cuando el usuario YA estaba
  // abajo del todo (mensaje nuevo / envío propio). Si scrolleó hacia arriba a leer historial,
  // NO lo movemos — antes el poll cada 12s lo tiraba al fondo y perdía dónde estaba leyendo.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!didInitialScrollRef.current || atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      if (messages.length > 0) didInitialScrollRef.current = true;
    }
  }, [messages, pending]);

  // Autogrow del textarea (multilínea sin romper el layout).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  // Soporte de grabación: gateamos SOLO por la existencia de MediaRecorder (presente en iOS 14.3+
  // y Android/Chrome). No exigimos `navigator.mediaDevices.getUserMedia` acá porque en iOS puede
  // venir `undefined` a la carga (Safari en ciertos contextos) y escondía el micrófono en iPhone,
  // aunque el permiso sí funciona al pedirlo. Si al tocar el micro no hay acceso, startRec muestra
  // un mensaje claro. (Antes: el botón directamente no aparecía en iOS.)
  useEffect(() => {
    setMicSupported(typeof MediaRecorder !== "undefined");
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
    (tempId: string, msg: string, reply?: Msg | null) => {
      void (async () => {
        try {
          const res = await fetchWithSupabaseSession(
            `/api/mobile/asesor/conversations/${conversationId}/send`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                message: msg,
                // wamid → cita real en WhatsApp; contexto → snapshot para nuestra UI.
                ...(reply?.wa_message_id ? { reply_to_wamid: reply.wa_message_id } : {}),
                ...(reply
                  ? {
                      reply_context: {
                        wa_message_id: reply.wa_message_id ?? null,
                        from_me: reply.from_me,
                        preview: previewOf(reply),
                        message_type: reply.message_type,
                      },
                    }
                  : {}),
              }),
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

  const previewOf = (m: Msg) => (m.content?.trim() || `[${m.message_type}]`).slice(0, 160);

  // ── Deslizar una burbuja para citarla ──────────────────────────────────────
  // Umbral de 56 px, igual que WhatsApp. El eje se decide en el primer movimiento
  // (`locked`) para no pelear con el scroll vertical de la lista.
  const SWIPE_THRESHOLD = 56;

  const onBubbleTouchStart = useCallback((e: React.TouchEvent, m: Msg) => {
    if (!m.wa_message_id) return; // sin wamid no hay nada que citar
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY, locked: false };
    setSwipe({ id: m.id, dx: 0 });
  }, []);

  const onBubbleTouchMove = useCallback((e: React.TouchEvent, m: Msg) => {
    const st = swipeStart.current;
    if (!st) return;
    const t = e.touches[0];
    const dx = t.clientX - st.x;
    const dy = t.clientY - st.y;
    if (!st.locked) {
      // Primer movimiento: si es más vertical que horizontal, es scroll → soltar.
      if (Math.abs(dy) > Math.abs(dx)) {
        swipeStart.current = null;
        setSwipe(null);
        return;
      }
      st.locked = true;
    }
    // Sólo hacia la derecha, con tope para que no se despegue de la pantalla.
    setSwipe({ id: m.id, dx: Math.max(0, Math.min(dx, SWIPE_THRESHOLD + 16)) });
  }, []);

  const onBubbleTouchEnd = useCallback(
    (m: Msg) => {
      const dx = swipe?.id === m.id ? swipe.dx : 0;
      swipeStart.current = null;
      setSwipe(null);
      if (dx >= SWIPE_THRESHOLD && m.wa_message_id) {
        setReplyTo(m);
        taRef.current?.focus();
      }
    },
    [swipe]
  );

  const send = useCallback(() => {
    const msg = text.trim();
    if (!msg) return;
    const tempId = `tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    // Se captura antes de limpiar el estado: el envío es asíncrono y para entonces
    // replyTo ya volvió a null.
    const reply = replyTo;
    setText("");
    setShowEmoji(false);
    setSendErr(null);
    setReplyTo(null);
    setPending((p) => [...p, { tempId, kind: "text", content: msg, status: "sending" }]);
    deliverText(tempId, msg, reply);
  }, [text, replyTo, deliverText]);

  const sendAudio = useCallback(
    (file: File) => {
      const tempId = `tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      setSendErr(null);
      setPending((p) => [...p, { tempId, kind: "audio", content: "Nota de voz", file, status: "sending" }]);
      deliverAudio(tempId, file);
    },
    [deliverAudio]
  );

  // Imagen / video: mismo endpoint de media (detecta el tipo por el archivo). Optimista.
  const sendFile = useCallback(
    (file: File) => {
      if (!file || file.size < 1) return;
      const tempId = `tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      setSendErr(null);
      const label = file.type.startsWith("video/") ? "📹 Video" : file.type.startsWith("image/") ? "🖼️ Imagen" : "📎 Archivo";
      setPending((p) => [...p, { tempId, kind: "file", content: label, file, status: "sending" }]);
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
      setSendErr(
        "Este navegador no permite grabar audio. En iPhone: actualizá iOS y abrí la app desde Safari (no desde un navegador dentro de otra app)."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelRecRef.current = false;
      const mime = pickRecorderMimeType();
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
        const ext = extForAudioType(blob.type);
        const file = new File([blob], `nota-voz.${ext}`, { type: blob.type || "audio/webm" });
        sendAudio(file);
      };
      setRecording(true);
      setRecSecs(0);
      recTimerRef.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
      // SIN timeslice: MediaRecorder acumula todo y emite UN solo blob completo al stop().
      // Con timeslice (start(400)) el WebView de Android arma un webm con header roto / cluster
      // final truncado → ffmpeg falla ("EBML header parsing failed") o el audio sale cortado.
      rec.start();
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

  // ---- Recontacto con plantilla ----
  async function openTpl() {
    setTplOpen(true);
    setTplErr(null);
    setTplSelId(null);
    setTplVars({});
    setTplLoading(true);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/chat/templates?conversation_id=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as { data?: Tpl[] };
      setTplList(Array.isArray(json.data) ? json.data : []);
    } catch {
      setTplList([]);
      setTplErr("No se pudieron cargar las plantillas.");
    } finally {
      setTplLoading(false);
    }
  }

  function pickTpl(t: Tpl) {
    setTplSelId(t.id);
    setTplErr(null);
    const slots = extractBodyPlaceholderKeysOrdered(t.components_json ?? []);
    const nombre = /\p{L}/u.test(title) && title !== "Chat" ? title.trim() : "";
    const init: Record<string, string> = {};
    for (const s of slots) {
      const low = s.toLowerCase();
      init[s] = low === "nombre" || low === "1" || low.includes("nombre") ? nombre : "";
    }
    setTplVars(init);
  }

  async function sendTpl() {
    const t = tplList.find((x) => x.id === tplSelId);
    if (!t || tplSending) return;
    const slots = extractBodyPlaceholderKeysOrdered(t.components_json ?? []);
    const missing = slots.filter((s) => !(tplVars[s] ?? "").trim());
    if (missing.length > 0) {
      setTplErr(`Completá: ${missing.join(", ")}`);
      return;
    }
    setTplSending(true);
    setTplErr(null);
    try {
      const res = await fetchWithSupabaseSession("/api/chat/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, template_id: t.id, variables: tplVars }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Error ${res.status}`);
      setTplOpen(false);
      setTplSelId(null);
      setTplVars({});
      await load(true);
    } catch (e) {
      setTplErr(e instanceof Error ? e.message : "No se pudo enviar la plantilla");
    } finally {
      setTplSending(false);
    }
  }

  const tplSel = tplList.find((t) => t.id === tplSelId) ?? null;
  const tplSlots = tplSel ? extractBodyPlaceholderKeysOrdered(tplSel.components_json ?? []) : [];
  const tplPreview = tplSel
    ? getBodyComponentText(tplSel.components_json ?? []).replace(PLACEHOLDER_RE, (_m, rawKey: string) => {
        const k = String(rawKey).trim();
        const v = (tplVars[k] ?? "").trim();
        return v || `{{${k}}}`;
      })
    : "";

  // Header estilo WhatsApp: nombre (o número si no hay nombre) arriba, y debajo el número.
  const phoneDisplay = fmtPhone(contactPhone);
  const titleIsPhone =
    Boolean(contactPhone) && title.replace(/[^\d]/g, "") === (contactPhone ?? "").replace(/[^\d]/g, "");
  const headerTitle = titleIsPhone ? phoneDisplay : title;
  const headerSub =
    [
      !titleIsPhone && phoneDisplay ? phoneDisplay : null,
      windowOpen === false ? "Ventana 24 h cerrada" : windowOpen === true ? "Ventana 24 h abierta" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "WhatsApp";

  return (
    <div className="min-h-svh max-h-svh bg-slate-50 flex flex-col">
      <header
        className="sticky top-0 z-10 bg-[#3F8E91] text-white px-2 pb-2.5 shadow-sm flex items-center gap-2"
        // iOS: respetar la barra de estado (notch). env(safe-area-inset-top)=0 en Android/web.
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.625rem)" }}
      >
        <button onClick={() => router.push("/m/asesor")} aria-label="Volver" className="h-9 w-9 grid place-items-center rounded-full active:bg-white/15 text-lg">
          ‹
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight">{headerTitle}</h1>
          <p className="text-[11px] text-white/80 leading-tight truncate">{headerSub}</p>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
      >
        {loading ? (
          <div className="text-center text-slate-400 text-sm animate-pulse py-6">Cargando…</div>
        ) : err ? (
          <div className="m-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">{err}</div>
        ) : messages.length === 0 && pending.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-6">Sin mensajes.</div>
        ) : (
          <>
            {messages.map((m) => (
              <div
                key={m.id}
                className={`relative flex ${m.from_me ? "justify-end" : "justify-start"}`}
                onTouchStart={(e) => onBubbleTouchStart(e, m)}
                onTouchMove={(e) => onBubbleTouchMove(e, m)}
                onTouchEnd={() => onBubbleTouchEnd(m)}
                onTouchCancel={() => onBubbleTouchEnd(m)}
              >
                {swipe?.id === m.id && swipe.dx > 8 ? (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none"
                    style={{ opacity: Math.min(1, swipe.dx / SWIPE_THRESHOLD) }}
                  >
                    ↩
                  </span>
                ) : null}
                <div
                  style={
                    swipe?.id === m.id
                      ? { transform: `translateX(${swipe.dx}px)` }
                      : { transform: "translateX(0)", transition: "transform 140ms ease-out" }
                  }
                  className={`max-w-[78%] rounded-2xl px-3 py-2 text-[14px] leading-snug shadow-sm ${
                    m.from_me ? "bg-[#4FAEB2] text-white rounded-br-md" : "bg-white text-slate-800 border border-slate-100 rounded-bl-md"
                  }`}
                >
                  {(() => {
                    const rc = m.raw_payload?.reply_context as
                      | { preview?: string; from_me?: boolean }
                      | undefined;
                    if (!rc || typeof rc !== "object") return null;
                    return (
                      <div
                        className={`mb-1.5 rounded-lg border-l-[3px] px-2 py-1 text-[12px] ${
                          m.from_me
                            ? "border-white/60 bg-white/15 text-white/90"
                            : "border-[#4FAEB2] bg-slate-50 text-slate-600"
                        }`}
                      >
                        <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-80">
                          {rc.from_me ? "Vos" : "Cliente"}
                        </span>
                        <span className="line-clamp-2 break-words">{rc.preview ?? "Mensaje"}</span>
                      </div>
                    );
                  })()}
                  <MessageBody m={m} />
                  {m.from_me && m.whatsapp_delivery_status === "failed" ? (
                    <div className="mt-1 rounded-md bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-700 flex items-start gap-1">
                      <span aria-hidden>⚠</span>
                      <span>
                        <span className="font-semibold">No entregado.</span>{" "}
                        {friendlyWhatsappFailureReason(extractWhatsappFailureInfo(m.raw_payload))}
                      </span>
                    </div>
                  ) : null}
                  {m.created_at ? (
                    <div
                      className={`mt-0.5 text-right text-[10px] leading-none ${
                        m.from_me ? "text-white/70" : "text-slate-400"
                      }`}
                    >
                      {fmtTime(m.created_at)}
                    </div>
                  ) : null}
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
        <button
          type="button"
          onClick={() => void openTpl()}
          className="w-full text-left px-3 py-2 bg-amber-50 border-t border-amber-200 text-amber-800 text-[12px] active:bg-amber-100"
        >
          Ventana de 24 h cerrada: tocá acá para <b>recontactar con una plantilla</b> aprobada.
        </button>
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
            {replyTo ? (
              <div className="mb-2 flex items-start gap-2 rounded-xl border-l-4 border-[#4FAEB2] bg-slate-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-[#3F8E91]">
                    {replyTo.from_me ? "Vos" : title}
                  </div>
                  <div className="truncate text-[12px] text-slate-600">
                    {replyTo.content?.trim() || `[${replyTo.message_type}]`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancelar respuesta"
                  className="shrink-0 h-6 w-6 grid place-items-center rounded-full text-slate-400 active:bg-slate-200"
                >
                  ✕
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) sendFile(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Adjuntar imagen o video"
                className="shrink-0 h-10 w-10 grid place-items-center rounded-full text-xl text-slate-500 active:bg-slate-100"
              >
                📎
              </button>
              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                aria-label="Emojis"
                className="shrink-0 h-10 w-10 grid place-items-center rounded-full text-xl active:bg-slate-100"
              >
                😊
              </button>
              <button
                type="button"
                onClick={() => void openTpl()}
                aria-label="Enviar plantilla / recontactar"
                className={`shrink-0 h-10 w-10 grid place-items-center rounded-full text-lg active:scale-95 ${
                  windowOpen === false ? "bg-amber-100 text-amber-700" : "text-slate-500 active:bg-slate-100"
                }`}
              >
                📄
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

      {tplOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setTplOpen(false)}>
          <div
            className="max-h-[80svh] rounded-t-2xl bg-white flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-800">Recontactar con plantilla</span>
              <button type="button" onClick={() => setTplOpen(false)} className="text-slate-400 text-lg" aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {tplLoading ? (
                <p className="py-6 text-center text-sm text-slate-400">Cargando plantillas…</p>
              ) : tplList.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No hay plantillas aprobadas para este canal.</p>
              ) : !tplSel ? (
                <ul className="space-y-1">
                  {tplList.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => pickTpl(t)}
                        className="w-full rounded-xl border border-slate-100 px-3 py-2.5 text-left active:bg-slate-50"
                      >
                        <span className="block text-sm font-semibold text-slate-900">{t.name}</span>
                        <span className="mt-0.5 line-clamp-2 text-[12px] text-slate-500">
                          {getBodyComponentText(t.components_json ?? [])}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      setTplSelId(null);
                      setTplVars({});
                      setTplErr(null);
                    }}
                    className="text-[12px] text-[#3F8E91]"
                  >
                    ← Elegir otra
                  </button>
                  <p className="text-sm font-semibold text-slate-800">{tplSel.name}</p>
                  {tplSlots.map((s) => (
                    <label key={s} className="block">
                      <span className="mb-1 block text-[12px] font-medium text-slate-600">{s}</span>
                      <input
                        type="text"
                        value={tplVars[s] ?? ""}
                        onChange={(e) => setTplVars((prev) => ({ ...prev, [s]: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40"
                        placeholder={`Valor para ${s}`}
                      />
                    </label>
                  ))}
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Vista previa
                    </span>
                    <p className="whitespace-pre-wrap break-words text-[13px] text-slate-700">{tplPreview}</p>
                  </div>
                  {tplErr ? <p className="text-[12px] text-red-600">{tplErr}</p> : null}
                  <button
                    type="button"
                    onClick={() => void sendTpl()}
                    disabled={tplSending}
                    className="w-full rounded-2xl bg-[#3F8E91] px-4 py-3 text-sm font-semibold text-white active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    {tplSending ? "Enviando…" : "Enviar plantilla"}
                  </button>
                </div>
              )}
              {tplErr && !tplSel ? <p className="mt-2 text-center text-[12px] text-red-600">{tplErr}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
