"use client";

/**
 * Chat interno del equipo.
 *
 * Dos paneles: la bandeja de salas a la izquierda y la conversación a la
 * derecha. Los mensajes nuevos llegan por Realtime sobre `chat_interno_mensajes`,
 * el mismo mecanismo que ya usan Conversaciones y la tarjeta de proyecto.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Square,
  Users,
  X,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { supabase } from "@/lib/supabase";
import { inicialesNombre, nombreCapitular, nombreCorto } from "@/lib/format/nombres";

type Sala = {
  id: string;
  tipo: string;
  nombre: string;
  miembros: number;
  miembros_nombres: string[];
  ultimo_mensaje_at: string | null;
  no_leidos: number;
  vista_previa: string;
  vista_previa_autor: string;
};

type Adjunto = {
  path: string;
  nombre: string;
  mime_type: string;
  size_bytes: number;
  clase: "audio" | "imagen" | "archivo";
  url?: string | null;
};

type Mensaje = {
  id: string;
  usuario_id: string | null;
  autor: string;
  texto: string | null;
  adjuntos: Adjunto[];
  created_at: string;
  eliminado: boolean;
  propio: boolean;
};

type UsuarioOpcion = { id: string; nombre: string; area: string };

const COLORES = ["#4FAEB2", "#8b5cf6", "#f59e0b", "#ec4899", "#22c55e", "#0ea5e9"];
function colorDe(texto: string): string {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return COLORES[h % COLORES.length];
}

function hora(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })
    : "";
}

function diaLabel(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 86400000);
  const mismo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mismo(d, hoy)) return "Hoy";
  if (mismo(d, ayer)) return "Ayer";
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "long" });
}

function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ChatInternoClient() {
  const [salas, setSalas] = useState<Sala[]>([]);
  const [salaId, setSalaId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoSalas, setCargandoSalas] = useState(true);
  const [cargandoMsgs, setCargandoMsgs] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [acceso, setAcceso] = useState<"cargando" | "ok" | "denegado">("cargando");

  const [texto, setTexto] = useState("");
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLDivElement>(null);

  // --- Nuevo grupo / conversación -------------------------------------------
  const [modal, setModal] = useState(false);
  const [usuarios, setUsuarios] = useState<UsuarioOpcion[]>([]);
  const [nombreGrupo, setNombreGrupo] = useState("");
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [buscaUsuario, setBuscaUsuario] = useState("");

  // --- Grabación de audio ----------------------------------------------------
  const [grabando, setGrabando] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const salaActual = useMemo(() => salas.find((s) => s.id === salaId) ?? null, [salas, salaId]);

  const cargarSalas = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession("/api/chat-interno/salas", { cache: "no-store" });
      if (r.status === 403) {
        setAcceso("denegado");
        return;
      }
      const j = (await r.json().catch(() => ({}))) as { data?: { salas?: Sala[] } };
      setAcceso("ok");
      setSalas(j?.data?.salas ?? []);
    } catch {
      setErr("No se pudieron cargar las conversaciones");
    } finally {
      setCargandoSalas(false);
    }
  }, []);

  const cargarMensajes = useCallback(async (id: string) => {
    setCargandoMsgs(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${id}/mensajes`, {
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { data?: { mensajes?: Mensaje[] } };
      setMensajes(j?.data?.mensajes ?? []);
      await fetchWithSupabaseSession(`/api/chat-interno/salas/${id}/leido`, { method: "POST" });
      setSalas((prev) => prev.map((s) => (s.id === id ? { ...s, no_leidos: 0 } : s)));
    } finally {
      setCargandoMsgs(false);
    }
  }, []);

  useEffect(() => {
    void cargarSalas();
  }, [cargarSalas]);

  useEffect(() => {
    if (salaId) void cargarMensajes(salaId);
    else setMensajes([]);
  }, [salaId, cargarMensajes]);

  // Realtime: un mensaje nuevo en la sala abierta se agrega sin recargar.
  useEffect(() => {
    if (!salaId) return;
    const canal = supabase
      .channel(`chat-interno-${salaId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "neura", table: "chat_interno_mensajes", filter: `sala_id=eq.${salaId}` },
        () => {
          void cargarMensajes(salaId);
          void cargarSalas();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [salaId, cargarMensajes, cargarSalas]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  async function subirArchivos(files: File[]) {
    if (!salaId || files.length === 0) return;
    setSubiendo(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}/adjuntos`, {
          method: "POST",
          body: fd,
        });
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: Adjunto; error?: string };
        if (!r.ok || !j.success || !j.data) {
          setErr(j.error ?? `No se pudo subir "${f.name}"`);
          continue;
        }
        setAdjuntos((prev) => [...prev, j.data as Adjunto]);
      }
    } finally {
      setSubiendo(false);
    }
  }

  async function enviar() {
    if (!salaId) return;
    if (!texto.trim() && adjuntos.length === 0) return;
    setEnviando(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, adjuntos }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setErr(j.error ?? "No se pudo enviar");
        return;
      }
      setTexto("");
      setAdjuntos([]);
      await cargarMensajes(salaId);
      void cargarSalas();
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Grabación de audio con `MediaRecorder`, que es API del navegador y no
   * necesita ninguna librería. Requiere permiso del micrófono y HTTPS.
   */
  async function alternarGrabacion() {
    if (grabando) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGrabando(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        const ext = (rec.mimeType || "audio/webm").includes("ogg") ? "ogg" : "webm";
        await subirArchivos([new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type })]);
      };
      rec.start();
      recRef.current = rec;
      setGrabando(true);
    } catch {
      setErr("No se pudo acceder al micrófono. Revisá el permiso del navegador.");
    }
  }

  async function abrirModal() {
    setModal(true);
    setNombreGrupo("");
    setElegidos([]);
    setBuscaUsuario("");
    const r = await fetchWithSupabaseSession("/api/chat-interno/usuarios", { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { data?: { usuarios?: UsuarioOpcion[] } };
    setUsuarios(j?.data?.usuarios ?? []);
  }

  async function crearSala() {
    // Con una sola persona y sin nombre es una conversación directa; con nombre
    // o con varias, un grupo. Se deduce en vez de pedir que lo elijan.
    const esDirecto = elegidos.length === 1 && !nombreGrupo.trim();
    const r = await fetchWithSupabaseSession("/api/chat-interno/salas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: esDirecto ? "directo" : "grupo",
        nombre: nombreGrupo,
        miembros: elegidos,
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: { id?: string }; error?: string };
    if (!r.ok || !j.success || !j.data?.id) {
      setErr(j.error ?? "No se pudo crear");
      return;
    }
    setModal(false);
    await cargarSalas();
    setSalaId(j.data.id);
  }

  if (acceso === "denegado") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-slate-700">Este módulo es de acceso restringido</p>
        <p className="text-xs text-slate-400">Pedí que te habiliten el módulo Chat interno.</p>
      </div>
    );
  }

  const usuariosFiltrados = usuarios.filter((u) =>
    buscaUsuario.trim() ? u.nombre.toLowerCase().includes(buscaUsuario.trim().toLowerCase()) : true
  );

  return (
    <div className="flex h-[calc(100dvh-190px)] min-h-[520px] gap-3">
      {/* --- Bandeja ---------------------------------------------------------- */}
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
          <h2 className="text-[13px] font-semibold text-slate-700">Conversaciones</h2>
          <button
            type="button"
            onClick={abrirModal}
            title="Nueva conversación"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#4FAEB2] text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {cargandoSalas ? (
            <p className="px-2 py-3 text-[12px] text-slate-400">Cargando…</p>
          ) : salas.length === 0 ? (
            <p className="px-2 py-3 text-[12px] leading-relaxed text-slate-400">
              Todavía no tenés conversaciones. Creá la primera con el botón de arriba.
            </p>
          ) : (
            salas.map((s) => {
              const activa = s.id === salaId;
              const c = colorDe(s.nombre);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSalaId(s.id)}
                  className={`mb-1 flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    activa ? "bg-[#4FAEB2]/10" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: `${c}22`, color: c }}
                  >
                    {s.tipo === "grupo" ? <Users className="h-4 w-4" /> : inicialesNombre(s.nombre)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-1">
                      <span className="min-w-0 truncate text-[12.5px] font-semibold text-slate-800">
                        {nombreCapitular(s.nombre)}
                      </span>
                      {s.no_leidos > 0 ? (
                        <span className="shrink-0 rounded-full bg-[#4FAEB2] px-1.5 text-[10px] font-bold text-white">
                          {s.no_leidos}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {s.vista_previa
                        ? `${s.vista_previa_autor ? `${nombreCorto(s.vista_previa_autor)}: ` : ""}${s.vista_previa}`
                        : s.tipo === "grupo"
                          ? `${s.miembros} integrantes`
                          : "Sin mensajes"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* --- Conversación ------------------------------------------------------ */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {!salaActual ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-slate-400">
            Elegí una conversación o creá una nueva.
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-2.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: `${colorDe(salaActual.nombre)}22`, color: colorDe(salaActual.nombre) }}
              >
                {salaActual.tipo === "grupo" ? (
                  <Users className="h-4 w-4" />
                ) : (
                  inicialesNombre(salaActual.nombre)
                )}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-[13.5px] font-semibold text-slate-800">
                  {nombreCapitular(salaActual.nombre)}
                </h2>
                <p className="truncate text-[11px] text-slate-400">
                  {salaActual.tipo === "grupo"
                    ? salaActual.miembros_nombres.map((n) => nombreCorto(n)).join(", ")
                    : "Conversación directa"}
                </p>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50/60 px-4 py-3">
              {cargandoMsgs && mensajes.length === 0 ? (
                <p className="text-center text-[12px] text-slate-400">Cargando…</p>
              ) : mensajes.length === 0 ? (
                <p className="text-center text-[12px] text-slate-400">
                  Todavía no hay mensajes. Escribí el primero.
                </p>
              ) : (
                mensajes.map((m, i) => {
                  const previo = mensajes[i - 1];
                  const nuevoDia =
                    !previo || diaLabel(previo.created_at) !== diaLabel(m.created_at);
                  // Mensajes seguidos de la misma persona no repiten el nombre.
                  const seguido = previo && previo.usuario_id === m.usuario_id && !nuevoDia;
                  const c = colorDe(m.autor);
                  return (
                    <div key={m.id}>
                      {nuevoDia ? (
                        <div className="my-3 flex items-center gap-2">
                          <span className="h-px flex-1 bg-slate-200" />
                          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            {diaLabel(m.created_at)}
                          </span>
                          <span className="h-px flex-1 bg-slate-200" />
                        </div>
                      ) : null}
                      <div className={`flex gap-2 ${m.propio ? "justify-end" : "justify-start"}`}>
                        {!m.propio ? (
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                              seguido ? "invisible" : ""
                            }`}
                            style={{ background: `${c}22`, color: c }}
                          >
                            {inicialesNombre(m.autor)}
                          </span>
                        ) : null}
                        <div
                          className={`max-w-[68%] rounded-2xl px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${
                            m.propio
                              ? "rounded-br-sm bg-[#4FAEB2] text-white"
                              : "rounded-bl-sm border border-slate-200 bg-white text-slate-700"
                          }`}
                        >
                          {!m.propio && !seguido ? (
                            <div className="mb-0.5 text-[10.5px] font-bold" style={{ color: c }}>
                              {nombreCorto(m.autor)}
                            </div>
                          ) : null}
                          {m.eliminado ? (
                            <p className="text-[12px] italic opacity-60">Mensaje eliminado</p>
                          ) : (
                            <>
                              {m.texto ? (
                                <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug">
                                  {m.texto}
                                </p>
                              ) : null}
                              {m.adjuntos.map((a) => (
                                <div key={a.path} className="mt-1.5">
                                  {a.clase === "audio" && a.url ? (
                                    <audio controls src={a.url} className="h-9 w-56 max-w-full" />
                                  ) : a.clase === "imagen" && a.url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={a.url}
                                      alt={a.nombre}
                                      className="max-h-56 rounded-lg border border-black/5"
                                    />
                                  ) : (
                                    <a
                                      href={a.url ?? "#"}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] ${
                                        m.propio ? "bg-white/15" : "bg-slate-50"
                                      }`}
                                    >
                                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                                      <span className="min-w-0 truncate">{a.nombre}</span>
                                      <span className="shrink-0 opacity-60">
                                        {pesoLegible(a.size_bytes)}
                                      </span>
                                    </a>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                          <div
                            className={`mt-0.5 text-right text-[9.5px] ${
                              m.propio ? "text-white/70" : "text-slate-400"
                            }`}
                          >
                            {hora(m.created_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={finRef} />
            </div>

            {/* --- Redacción ---------------------------------------------------- */}
            <div className="border-t border-slate-100 px-3 py-2.5">
              {adjuntos.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {adjuntos.map((a) => (
                    <span
                      key={a.path}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
                    >
                      <Paperclip className="h-3 w-3" />
                      <span className="max-w-[160px] truncate">{a.nombre}</span>
                      <button
                        type="button"
                        onClick={() => setAdjuntos((p) => p.filter((x) => x.path !== a.path))}
                        aria-label={`Quitar ${a.nombre}`}
                      >
                        <X className="h-3 w-3 text-slate-400 hover:text-slate-700" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={subiendo}
                  title="Adjuntar archivo"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
                >
                  {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={alternarGrabacion}
                  title={grabando ? "Detener y enviar audio" : "Grabar audio"}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                    grabando
                      ? "animate-pulse border-rose-300 bg-rose-50 text-rose-600"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {grabando ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <textarea
                  rows={1}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter envía; Shift+Enter hace salto de línea, como en Bitrix.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void enviar();
                    }
                  }}
                  onPaste={(e) => {
                    const imgs = Array.from(e.clipboardData?.items ?? [])
                      .filter((i) => i.kind === "file")
                      .map((i) => i.getAsFile())
                      .filter((f): f is File => !!f && f.size > 0);
                    if (imgs.length > 0) {
                      e.preventDefault();
                      void subirArchivos(imgs);
                    }
                  }}
                  placeholder="Escribí un mensaje…"
                  className="max-h-32 min-h-[36px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
                />
                <button
                  type="button"
                  onClick={() => void enviar()}
                  disabled={enviando || (!texto.trim() && adjuntos.length === 0)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4FAEB2] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void subirArchivos(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </div>
          </>
        )}
      </section>

      {err ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-[12px] text-rose-700 shadow-lg">
          {err}
          <button type="button" onClick={() => setErr(null)} className="ml-3 font-semibold">
            Cerrar
          </button>
        </div>
      ) : null}

      {/* --- Nueva conversación ------------------------------------------------ */}
      {modal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="text-[14px] font-semibold text-slate-800">Nueva conversación</h3>
              <button type="button" onClick={() => setModal(false)} aria-label="Cerrar">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Nombre del grupo
                </span>
                <input
                  value={nombreGrupo}
                  onChange={(e) => setNombreGrupo(e.target.value)}
                  placeholder="Dejalo vacío para una conversación directa"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] focus:border-[#4FAEB2] focus:outline-none"
                />
              </label>
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Integrantes
                </span>
                <div className="mt-1 flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    value={buscaUsuario}
                    onChange={(e) => setBuscaUsuario(e.target.value)}
                    placeholder="Buscar…"
                    className="w-full bg-transparent text-[12.5px] focus:outline-none"
                  />
                </div>
                <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-slate-100 p-1">
                  {usuariosFiltrados.map((u) => {
                    const sel = elegidos.includes(u.id);
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setElegidos((p) => (sel ? p.filter((x) => x !== u.id) : [...p, u.id]))
                          }
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                            sel ? "bg-[#4FAEB2]/10 text-[#2F6E71]" : "text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[8.5px] font-bold"
                            style={{ background: `${colorDe(u.nombre)}22`, color: colorDe(u.nombre) }}
                          >
                            {inicialesNombre(u.nombre)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{nombreCapitular(u.nombre)}</span>
                          {sel ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                        </button>
                      </li>
                    );
                  })}
                  {usuariosFiltrados.length === 0 ? (
                    <li className="px-2 py-3 text-center text-[11px] text-slate-400">Sin resultados</li>
                  ) : null}
                </ul>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setModal(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void crearSala()}
                disabled={elegidos.length === 0 || (elegidos.length > 1 && !nombreGrupo.trim())}
                className="rounded-xl bg-[#4FAEB2] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                Crear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
