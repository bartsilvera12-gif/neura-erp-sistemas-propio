"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import CapacitorPushRegister from "@/components/CapacitorPushRegister";
import { attachmentCaptionForDisplay, textoDeVistaPrevia } from "@/lib/chat/message-erp-display";
import { useAsesorInbox } from "@/shared/hooks/useAsesorInbox";
import AsesorTabBar from "./AsesorTabBar";

function shortTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" });
}

const CLAVE_COLA = "neura:asesor:cola";

export default function MAsesorInboxPage() {
  // Cola elegida ("" = todas). Se recuerda en el dispositivo, como el filtro del escritorio.
  const [cola, setCola] = useState("");
  useEffect(() => {
    try {
      setCola(localStorage.getItem(CLAVE_COLA) ?? "");
    } catch {
      /* sin storage: todas */
    }
  }, []);
  const elegirCola = useCallback((id: string) => {
    setCola(id);
    try {
      localStorage.setItem(CLAVE_COLA, id);
    } catch {
      /* noop */
    }
  }, []);
  // "Sin leer": solo los chats con mensajes sin leer, como el filtro de WhatsApp.
  const [soloSinLeer, setSoloSinLeer] = useState(false);
  const {
    conversations: convs,
    isAgent,
    supervision,
    queues,
    isLoading: loading,
    error,
    refresh,
  } = useAsesorInbox(cola);
  // Si la cola guardada ya no está entre las del usuario, se vuelve a "Todas".
  useEffect(() => {
    if (cola && queues.length > 0 && !queues.some((q) => q.id === cola)) elegirCola("");
  }, [cola, queues, elegirCola]);
  const [q, setQ] = useState("");

  // ── Deslizar hacia abajo para refrescar ────────────────────────────────────
  // Sólo se arma cuando la lista ya está arriba del todo (scrollTop <= 0); si no,
  // el gesto es scroll normal. El arrastre se amortigua a la mitad y tiene tope,
  // para que se sienta elástico y no se despegue de la pantalla.
  const PULL_THRESHOLD = 64;
  const scrollerRef = useRef<HTMLElement | null>(null);
  const pullStartY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onPullStart = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    const el = scrollerRef.current;
    if (!el || el.scrollTop > 0) return;
    pullStartY.current = e.touches[0].clientY;
  }, [refreshing]);

  const onPullMove = useCallback((e: React.TouchEvent) => {
    const start = pullStartY.current;
    if (start == null) return;
    const dy = e.touches[0].clientY - start;
    if (dy <= 0) {
      // Cambió de dirección: devolvemos el control al scroll.
      pullStartY.current = null;
      setPull(0);
      return;
    }
    setPull(Math.min(dy * 0.5, PULL_THRESHOLD + 26));
  }, []);

  const onPullEnd = useCallback(() => {
    const dist = pull;
    pullStartY.current = null;
    setPull(0);
    if (dist < PULL_THRESHOLD || refreshing) return;
    setRefreshing(true);
    void Promise.resolve(refresh()).finally(() => setRefreshing(false));
  }, [pull, refresh, refreshing]);

  const filtered = (() => {
    const term = q.trim().toLowerCase();
    const base = soloSinLeer ? convs.filter((c) => c.unread_count > 0) : convs;
    if (!term) return base;
    const digits = term.replace(/\D/g, "");
    return base.filter((c) => {
      const nombre = (c.contact_nombre ?? "").toLowerCase();
      const tel = (c.contact_telefono ?? "").toLowerCase();
      const telDigits = tel.replace(/\D/g, "");
      return (
        nombre.includes(term) ||
        tel.includes(term) ||
        (digits.length >= 3 && telDigits.includes(digits))
      );
    });
  })();


  return (
    <div className="flex h-svh min-h-0 flex-col bg-slate-50">
      {/* Registro de push FCM: solo actúa dentro de la APK (Capacitor nativo); no-op en web. */}
      <CapacitorPushRegister />
      <header
        className="sticky top-0 z-10 bg-[#3F8E91] text-white px-4 pb-3 shadow-sm"
        // iOS: respetar la barra de estado (notch). env(safe-area-inset-top)=0 en Android/web.
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <h1 className="text-base font-semibold">{supervision ? "Conversaciones" : "Mis conversaciones"}</h1>
        <p className="text-[11px] text-white/80">Contact Center · Neura</p>
        <input
          type="search"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o número…"
          className="mt-2 w-full rounded-xl border border-white/20 bg-white/95 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-white/40"
          aria-label="Buscar conversación"
        />
        <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Filtro">
          {[
            { id: false, nombre: "Todos" },
            { id: true, nombre: "Sin leer" },
          ].map((f) => {
            const activo = f.id === soloSinLeer;
            return (
              <button
                key={f.nombre}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => setSoloSinLeer(f.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
                  activo ? "bg-white text-[#3F8E91]" : "bg-white/15 text-white active:bg-white/25"
                }`}
              >
                {f.nombre}
              </button>
            );
          })}
        </div>
        {queues.length > 1 ? (
          <div
            className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]"
            role="radiogroup"
            aria-label="Cola"
          >
            {[{ id: "", nombre: "Todas las colas" }, ...queues].map((q) => {
              const activa = q.id === cola;
              return (
                <button
                  key={q.id || "todas"}
                  type="button"
                  role="radio"
                  aria-checked={activa}
                  onClick={() => elegirCola(q.id)}
                  className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
                    activa ? "bg-white text-[#3F8E91]" : "bg-white/15 text-white active:bg-white/25"
                  }`}
                >
                  {q.nombre}
                </button>
              );
            })}
          </div>
        ) : null}
      </header>

      <main
        ref={scrollerRef}
        onTouchStart={onPullStart}
        onTouchMove={onPullMove}
        onTouchEnd={onPullEnd}
        onTouchCancel={onPullEnd}
        // `contain` evita que el rebote elástico del WebView se propague a la página.
        // `min-h-0` es obligatorio: sin él un hijo flex no puede encogerse por debajo de
        // su contenido, el scroller nunca desborda y en Android la lista no scrollea.
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
      >
        {pull > 0 || refreshing ? (
          <div
            className="grid place-items-center overflow-hidden text-[12px] text-slate-400"
            style={{
              height: refreshing ? 44 : pull,
              transition: pull > 0 ? undefined : "height 160ms ease-out",
            }}
          >
            {refreshing
              ? "Actualizando…"
              : pull >= PULL_THRESHOLD
                ? "Soltá para actualizar"
                : "Deslizá para actualizar"}
          </div>
        ) : null}
        {loading ? (
          <div className="p-6 text-center text-slate-400 text-sm animate-pulse">Cargando…</div>
        ) : error && convs.length === 0 ? (
          <div className="p-4 m-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error.message}
            <button onClick={() => void refresh()} className="ml-2 underline">
              Reintentar
            </button>
          </div>
        ) : !isAgent && !supervision ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            Tu usuario no está configurado como asesor de chat.
          </div>
        ) : convs.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            {cola
              ? "No hay conversaciones en esta cola."
              : supervision
                ? "No hay conversaciones."
                : "No tenés conversaciones asignadas."}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            {q.trim() ? `Sin resultados para “${q.trim()}”.` : "No hay chats sin leer."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((c) => {
              const title = c.contact_nombre || c.contact_telefono || "Contacto";
              return (
                <li key={c.id}>
                  <Link
                    href={`/m/asesor/chat/${c.id}${supervision ? "?s=1" : ""}`}
                    className="flex items-center gap-3 px-4 py-3 active:bg-slate-100"
                  >
                    <div className="h-10 w-10 shrink-0 rounded-full bg-[#4FAEB2]/15 text-[#3F8E91] grid place-items-center font-semibold">
                      {title.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-slate-800 text-sm">{title}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{shortTime(c.last_message_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] text-slate-500">
                          {c.last_message_from_me ? <span className="font-medium text-slate-400">Vos: </span> : null}
                          {textoDeVistaPrevia(c.last_message_preview) ?? (attachmentCaptionForDisplay(c.last_message_preview) || "—")}
                        </span>
                        {c.unread_count > 0 ? (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#4FAEB2] text-white text-[10px] font-bold grid place-items-center">
                            {c.unread_count}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <AsesorTabBar />
    </div>
  );
}
