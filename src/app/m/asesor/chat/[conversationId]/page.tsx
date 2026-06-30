"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Msg = {
  id: string;
  from_me: boolean;
  sender_type: string | null;
  content: string;
  message_type: string;
  created_at: string | null;
};

export default function MAsesorChatPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = (params?.conversationId as string) ?? "";
  const router = useRouter();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [title, setTitle] = useState("Chat");
  const [windowOpen, setWindowOpen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
  }, [messages]);

  const send = useCallback(async () => {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/mobile/asesor/conversations/${conversationId}/send`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: msg }) }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || data?.code === "whatsapp_window_closed") {
        setSendErr(
          data?.error || "La ventana de 24 h de WhatsApp está cerrada. Para reabrir hay que enviar una plantilla aprobada."
        );
        setWindowOpen(false);
        return;
      }
      if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo enviar");
      setText("");
      await load(true);
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }, [text, sending, conversationId, load]);

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
        ) : messages.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-6">Sin mensajes.</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3 py-2 text-[14px] leading-snug shadow-sm ${
                  m.from_me ? "bg-[#4FAEB2] text-white rounded-br-md" : "bg-white text-slate-800 border border-slate-100 rounded-bl-md"
                }`}
              >
                {m.message_type !== "text" ? (
                  <span className="italic opacity-80">[{m.message_type}]</span>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {windowOpen === false ? (
        <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-amber-800 text-[12px]">
          Ventana de 24 h cerrada: para reabrir el chat hay que enviar una plantilla aprobada (recontacto).
        </div>
      ) : null}
      {sendErr ? <div className="px-3 py-1.5 bg-red-50 text-red-700 text-[12px]">{sendErr}</div> : null}

      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-2 py-2 flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          placeholder="Escribí un mensaje…"
          className="flex-1 resize-none rounded-2xl border border-slate-200 px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40 max-h-28"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          className="shrink-0 h-10 px-4 rounded-2xl bg-[#3F8E91] text-white text-sm font-semibold disabled:opacity-40 active:scale-95 transition"
        >
          {sending ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
