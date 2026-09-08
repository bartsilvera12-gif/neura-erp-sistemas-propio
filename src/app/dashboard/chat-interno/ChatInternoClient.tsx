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
  ChevronLeft,
  FileText,
  ImageIcon,
  Link2,
  PanelRight,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Search,
  Send,
  Square,
  Trash2,
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

type Cita = { autor: string; texto: string | null };

/** Un adjunto ya compartido, visto desde el panel de archivos. */
type ItemArchivo = {
  path: string;
  nombre: string;
  mime_type: string;
  size_bytes: number;
  url: string | null;
  autor: string;
  created_at: string;
};

type ItemEnlace = {
  url: string;
  dominio: string;
  autor: string;
  created_at: string;
};

type Biblioteca = {
  imagenes: ItemArchivo[];
  audios: ItemArchivo[];
  archivos: ItemArchivo[];
  enlaces: ItemEnlace[];
  truncado: boolean;
};

type Mensaje = {
  id: string;
  usuario_id: string | null;
  autor: string;
  texto: string | null;
  adjuntos: Adjunto[];
  created_at: string;
  editado_at: string | null;
  eliminado: boolean;
  propio: boolean;
  responde_a: string | null;
  cita: Cita | null;
  reacciones: Record<string, string[]>;
  /** Los mismos emojis, pero con nombres: una reaccion anonima no dice nada. */
  reacciones_nombres: Record<string, string[]>;
  menciones: string[];
  /** Pintado al instante, todavia sin respuesta del servidor. */
  pendiente?: boolean;
};

/** Lista corta a propósito: se lee de un vistazo, un selector completo no. */
const EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

/**
 * Fondo de la conversación.
 *
 * Un gris plano deja los globos flotando sin apoyo y cansa la vista en una
 * pantalla que se mira todo el día. Un patrón muy tenue da profundidad y hace
 * que el blanco de los globos se lea como blanco. Va en un `data:` URI para no
 * sumar un pedido de red por una textura.
 */
const PATRON_FONDO =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'%3E%3Cg fill='none' stroke='%232F6E71' stroke-opacity='0.07' stroke-width='1.1' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 10h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6l-4 3v-3H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z'/%3E%3Ccircle cx='42' cy='14' r='5'/%3E%3Cpath d='M34 44h10a2 2 0 0 0 2-2v-8l-5-5h-7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2z'/%3E%3Cpath d='M8 38h14M8 44h9'/%3E%3C/g%3E%3C/svg%3E\")";

const ESTILO_FONDO: React.CSSProperties = {
  backgroundColor: "#eff5f6",
  backgroundImage: PATRON_FONDO,
  backgroundRepeat: "repeat",
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

/** Para la bandeja: "14:32" si es de hoy, "Ayer", o "23 ago". */
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 86400000);
  const mismo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mismo(d, hoy)) return hora(iso);
  if (mismo(d, ayer)) return "Ayer";
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "short" });
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

/**
 * `mobile`: en pantalla chica los dos paneles no entran uno al lado del otro,
 * así que se muestra uno por vez — la bandeja, o la conversación con un botón
 * para volver. Misma lógica, otro esqueleto: duplicar el componente sería
 * duplicar también cada arreglo futuro.
 */
export default function ChatInternoClient({ mobile = false }: { mobile?: boolean } = {}) {
  const [salas, setSalas] = useState<Sala[]>([]);
  const [salaId, setSalaId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoSalas, setCargandoSalas] = useState(true);
  const [cargandoMsgs, setCargandoMsgs] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [acceso, setAcceso] = useState<"cargando" | "ok" | "denegado">("cargando");

  const [texto, setTexto] = useState("");
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  /** Mensaje que se está respondiendo, o `null`. */
  const [citando, setCitando] = useState<Mensaje | null>(null);
  /** Mensaje en edición: su id y el texto en curso. */
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [busca, setBusca] = useState("");
  const [enBusqueda, setEnBusqueda] = useState(false);
  /** El buscador se despliega: en reposo es un icono, no una caja siempre visible. */
  const [verBuscador, setVerBuscador] = useState(false);
  /** Panel lateral "Acerca del chat": `null` cerrado. */
  const [panel, setPanel] = useState<"archivos" | null>(null);
  const [biblioteca, setBiblioteca] = useState<Biblioteca | null>(null);
  const [cargandoBiblio, setCargandoBiblio] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);
  /** Miembros de la sala abierta: alimentan el menú de menciones. */
  const [miembrosSala, setMiembrosSala] = useState<{ usuario_id: string; nombre: string }[]>([]);
  /** Mi nombre y mi id, para pintar el mensaje antes de que el servidor conteste. */
  const [yo, setYo] = useState<{ usuario_id: string; nombre: string } | null>(null);
  const [mencionados, setMencionados] = useState<{ id: string; nombre: string }[]>([]);
  const [consultaMencion, setConsultaMencion] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
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

  /**
   * `silencioso`: refresco de fondo (realtime, o reconciliar despues de enviar).
   * No prende el cartel de "Cargando…" ni espera al POST de lectura, que no
   * cambia nada de lo que se ve.
   */
  const cargarMensajes = useCallback(async (id: string, q?: string, silencioso = false) => {
    if (!silencioso) setCargandoMsgs(true);
    try {
      const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${id}/mensajes${qs}`, {
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { data?: { mensajes?: Mensaje[] } };
      const llegaron = j?.data?.mensajes ?? [];
      // Los pendientes se conservan hasta que el servidor los devuelva: si no,
      // el mensaje recien escrito parpadearia y desapareceria.
      setMensajes((prev) => {
        const confirmados = new Set(llegaron.map((m) => m.id));
        const enVuelo = prev.filter((m) => m.pendiente && !confirmados.has(m.id));
        return [...llegaron, ...enVuelo];
      });
      // Buscar no es leer la conversación: no marca nada como visto.
      if (!q) {
        void fetchWithSupabaseSession(`/api/chat-interno/salas/${id}/leido`, { method: "POST" });
        setSalas((prev) => prev.map((s) => (s.id === id ? { ...s, no_leidos: 0 } : s)));
      }
    } finally {
      if (!silencioso) setCargandoMsgs(false);
    }
  }, []);

  useEffect(() => {
    void cargarSalas();
  }, [cargarSalas]);

  useEffect(() => {
    if (salaId) void cargarMensajes(salaId);
    else setMensajes([]);
    setCitando(null);
    setEditando(null);
    setBusca("");
    setEnBusqueda(false);
    setMencionados([]);
  }, [salaId, cargarMensajes]);

  useEffect(() => {
    if (!salaId) {
      setMiembrosSala([]);
      return;
    }
    let cancel = false;
    fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}/miembros`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          data?: { miembros?: { usuario_id: string; nombre: string; propio: boolean }[] };
        };
        if (!cancel) {
          const todos = j?.data?.miembros ?? [];
          setMiembrosSala(todos.filter((m) => !m.propio));
          setYo(todos.find((m) => m.propio) ?? null);
        }
      })
      .catch(() => {
        if (!cancel) setMiembrosSala([]);
      });
    return () => {
      cancel = true;
    };
  }, [salaId]);

  // Realtime: un mensaje nuevo en la sala abierta se agrega sin recargar.
  useEffect(() => {
    if (!salaId) return;
    const canal = supabase
      .channel(`chat-interno-${salaId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "neura", table: "chat_interno_mensajes", filter: `sala_id=eq.${salaId}` },
        () => {
          void cargarMensajes(salaId, undefined, true);
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

  // El panel se arma cuando se abre, no antes: recorrer la sala entera es caro
  // y la mayoria de las veces nadie lo mira.
  const cargarBiblioteca = useCallback(async (id: string) => {
    setCargandoBiblio(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${id}/archivos`, {
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { data?: Biblioteca };
      setBiblioteca(
        j?.data ?? { imagenes: [], audios: [], archivos: [], enlaces: [], truncado: false }
      );
    } finally {
      setCargandoBiblio(false);
    }
  }, []);

  useEffect(() => {
    if (panel === "archivos" && salaId) void cargarBiblioteca(salaId);
  }, [panel, salaId, cargarBiblioteca]);

  // Cambiar de sala cierra lo que era de la anterior.
  useEffect(() => {
    setPanel(null);
    setBiblioteca(null);
    setVerBuscador(false);
  }, [salaId]);

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

  async function reaccionar(msgId: string, emoji: string) {
    // Optimista: la reacción se ve al instante y el servidor confirma. En un
    // chat, esperar el ida y vuelta para ver tu propio 👍 se siente roto.
    await fetchWithSupabaseSession(`/api/chat-interno/mensajes/${msgId}/reaccion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (salaId) void cargarMensajes(salaId, enBusqueda ? busca : undefined);
  }

  async function borrarMensaje(msgId: string) {
    if (!window.confirm("¿Eliminar este mensaje? Queda el aviso de que fue eliminado.")) return;
    const r = await fetchWithSupabaseSession(`/api/chat-interno/mensajes/${msgId}`, {
      method: "DELETE",
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!r.ok || !j.success) {
      setErr(j.error ?? "No se pudo eliminar");
      return;
    }
    if (salaId) void cargarMensajes(salaId, enBusqueda ? busca : undefined);
  }

  async function guardarEdicion() {
    if (!editando) return;
    const r = await fetchWithSupabaseSession(`/api/chat-interno/mensajes/${editando.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: editando.texto }),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!r.ok || !j.success) {
      setErr(j.error ?? "No se pudo editar");
      return;
    }
    setEditando(null);
    if (salaId) void cargarMensajes(salaId, enBusqueda ? busca : undefined);
  }

  /** El `@` abierto antes del cursor, si hay uno sin cerrar. */
  function detectarArroba(valor: string, cursor: number) {
    const antes = valor.slice(0, cursor);
    const i = antes.lastIndexOf("@");
    if (i < 0) return null;
    if (i > 0 && !/[\s(]/.test(antes[i - 1])) return null;
    const frag = antes.slice(i + 1);
    if (/\s/.test(frag)) return null;
    return { inicio: i, frag };
  }

  const sugeridosMencion =
    consultaMencion == null
      ? []
      : miembrosSala
          .filter((m) => !mencionados.some((x) => x.id === m.usuario_id))
          .filter((m) =>
            consultaMencion.trim()
              ? m.nombre.toLowerCase().includes(consultaMencion.trim().toLowerCase())
              : true
          )
          .slice(0, 6);

  function elegirMencion(m: { usuario_id: string; nombre: string }) {
    const area = areaRef.current;
    const cursor = area?.selectionStart ?? texto.length;
    const at = detectarArroba(texto, cursor);
    const corto = nombreCorto(m.nombre);
    setTexto(at ? `${texto.slice(0, at.inicio)}@${corto} ${texto.slice(cursor)}` : `${texto}@${corto} `);
    setMencionados((p) => (p.some((x) => x.id === m.usuario_id) ? p : [...p, { id: m.usuario_id, nombre: m.nombre }]));
    setConsultaMencion(null);
    requestAnimationFrame(() => area?.focus());
  }

  /**
   * Envio optimista: el mensaje aparece y el cuadro se vacia en el mismo
   * momento en que apretas Enter. Escribir no puede quedar esperando a la red
   * — el POST y el refresco corren atras, y si falla se retira el mensaje y se
   * devuelve el texto tal como estaba.
   */
  async function enviar() {
    if (!salaId) return;
    const cuerpo = texto;
    const files = adjuntos;
    const responde = citando;
    if (!cuerpo.trim() && files.length === 0) return;

    const menciones = mencionados
      // Sólo las que siguen escritas: si borró el @Nombre, no se notifica.
      .filter((m) => cuerpo.includes(`@${nombreCorto(m.nombre)}`))
      .map((m) => m.id);

    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimista: Mensaje = {
      id: tempId,
      usuario_id: yo?.usuario_id ?? null,
      autor: yo?.nombre ?? "Yo",
      texto: cuerpo.trim() || null,
      adjuntos: files,
      created_at: new Date().toISOString(),
      editado_at: null,
      eliminado: false,
      propio: true,
      responde_a: responde?.id ?? null,
      cita: responde ? { autor: responde.autor, texto: responde.texto } : null,
      reacciones: {},
      reacciones_nombres: {},
      menciones,
      pendiente: true,
    };

    setMensajes((prev) => [...prev, optimista]);
    setTexto("");
    setAdjuntos([]);
    setCitando(null);
    setMencionados([]);
    setConsultaMencion(null);
    setEnviando(true);

    try {
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: cuerpo,
          adjuntos: files,
          responde_a: responde?.id ?? undefined,
          menciones,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        data?: { id?: string };
      };
      if (!r.ok || !j.success) {
        setMensajes((prev) => prev.filter((m) => m.id !== tempId));
        setTexto(cuerpo);
        setAdjuntos(files);
        setCitando(responde);
        setErr(j.error ?? "No se pudo enviar");
        return;
      }
      // Ya tiene id real: deja de ser pendiente y el refresco lo reconoce.
      setMensajes((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, id: j.data?.id ?? m.id, pendiente: false } : m))
      );
      void cargarMensajes(salaId, undefined, true);
      void cargarSalas();
    } catch {
      setMensajes((prev) => prev.filter((m) => m.id !== tempId));
      setTexto(cuerpo);
      setAdjuntos(files);
      setCitando(responde);
      setErr("No se pudo enviar");
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

  /** Salir del buscador es volver a la conversación, no sólo vaciar el campo. */
  function cerrarBusqueda() {
    setVerBuscador(false);
    setBusca("");
    if (enBusqueda && salaId) {
      setEnBusqueda(false);
      void cargarMensajes(salaId);
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

  // En mobile sólo se ve un panel: la conversación si hay una abierta.
  const verBandeja = !mobile || !salaId;
  const verConversacion = !mobile || !!salaId;

  return (
    <div
      className={
        mobile
          ? "relative flex h-[calc(100dvh-150px)] min-h-[420px]"
          : "flex h-[calc(100dvh-190px)] min-h-[520px] gap-3"
      }
    >
      {/* --- Bandeja ---------------------------------------------------------- */}
      <aside
        className={`${verBandeja ? "flex" : "hidden"} ${
          mobile ? "w-full" : "w-72 shrink-0"
        } flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white`}
      >
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
                  className={`mb-0.5 flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                    activa ? "bg-[#4FAEB2]/12" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                    style={{ background: `${c}22`, color: c }}
                  >
                    {s.tipo === "grupo" ? <Users className="h-5 w-5" /> : inicialesNombre(s.nombre)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-slate-800">
                        {nombreCapitular(s.nombre)}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-slate-400">
                        {s.ultimo_mensaje_at ? fechaCorta(s.ultimo_mensaje_at) : ""}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11.5px] text-slate-400">
                        {s.vista_previa
                          ? `${s.vista_previa_autor ? `${nombreCorto(s.vista_previa_autor)}: ` : ""}${s.vista_previa}`
                          : s.tipo === "grupo"
                            ? `${s.miembros} integrantes`
                            : "Sin mensajes"}
                      </span>
                      {s.no_leidos > 0 ? (
                        <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#4FAEB2] px-1.5 text-[10px] font-bold text-white">
                          {s.no_leidos}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* --- Conversación ------------------------------------------------------ */}
      <section
        className={`${verConversacion ? "flex" : "hidden"} min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white`}
      >
        {!salaActual ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-slate-400">
            Elegí una conversación o creá una nueva.
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 sm:px-4">
              {mobile ? (
                <button
                  type="button"
                  onClick={() => {
                    setSalaId(null);
                    setCitando(null);
                    setEditando(null);
                    setBusca("");
                    setEnBusqueda(false);
                  }}
                  aria-label="Volver a las conversaciones"
                  className="-ml-1 shrink-0 rounded-lg p-1 text-slate-500 hover:bg-slate-50"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              ) : null}
              <span
                className={`${mobile ? "hidden" : "flex"} h-10 w-10 items-center justify-center rounded-full text-[11px] font-bold`}
                style={{ background: `${colorDe(salaActual.nombre)}22`, color: colorDe(salaActual.nombre) }}
              >
                {salaActual.tipo === "grupo" ? (
                  <Users className="h-5 w-5" />
                ) : (
                  inicialesNombre(salaActual.nombre)
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[14px] font-semibold text-slate-800">
                  {nombreCapitular(salaActual.nombre)}
                </h2>
                <p className="truncate text-[11px] text-slate-400">
                  {salaActual.tipo === "grupo"
                    ? salaActual.miembros_nombres.map((n) => nombreCorto(n)).join(", ")
                    : "Conversación directa"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {verBuscador ? (
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-2.5 py-1.5 ring-1 ring-transparent focus-within:ring-[#4FAEB2]/40">
                    <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <input
                      ref={buscaRef}
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && busca.trim()) {
                          setEnBusqueda(true);
                          void cargarMensajes(salaActual.id, busca);
                        }
                        if (e.key === "Escape") cerrarBusqueda();
                      }}
                      placeholder="Buscar en la conversación…"
                      className="w-36 bg-transparent text-[12px] focus:outline-none sm:w-52"
                    />
                    <button type="button" onClick={cerrarBusqueda} aria-label="Cerrar el buscador">
                      <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setVerBuscador(true);
                      // El foco va al input recien montado, no en el mismo tick.
                      setTimeout(() => buscaRef.current?.focus(), 0);
                    }}
                    title="Buscar mensajes"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#2F6E71]"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPanel((p) => (p ? null : "archivos"))}
                  title="Archivos y enlaces del chat"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    panel
                      ? "bg-[#4FAEB2]/15 text-[#2F6E71]"
                      : "text-slate-500 hover:bg-slate-100 hover:text-[#2F6E71]"
                  }`}
                >
                  <PanelRight className="h-4 w-4" />
                </button>
              </div>
            </header>
            {enBusqueda ? (
              <div className="flex items-center justify-between gap-2 border-b border-amber-100 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800">
                <span>
                  {mensajes.length === 0
                    ? `Sin resultados para "${busca}"`
                    : `${mensajes.length} ${mensajes.length === 1 ? "resultado" : "resultados"} para "${busca}"`}
                </span>
                <button
                  type="button"
                  onClick={cerrarBusqueda}
                  className="font-semibold underline underline-offset-2"
                >
                  Volver a la conversación
                </button>
              </div>
            ) : null}

            <div
              className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4"
              style={ESTILO_FONDO}
            >
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
                        <div className="my-4 flex justify-center">
                          <span className="rounded-full bg-white/80 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.06)] backdrop-blur-sm">
                            {diaLabel(m.created_at)}
                          </span>
                        </div>
                      ) : null}
                      <div className={`group flex gap-2 ${m.propio ? "justify-end" : "justify-start"}`}>
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
                          className={`max-w-[70%] min-w-[112px] rounded-2xl px-3.5 py-2.5 shadow-[0_1px_3px_rgba(15,23,42,0.10)] ${
                            m.propio
                              ? "rounded-br-md bg-gradient-to-br from-[#54B7BB] to-[#3E9B9F] text-white"
                              : "rounded-bl-md bg-white text-slate-700"
                          }`}
                        >
                          {!seguido ? (
                            <div
                              className={`mb-0.5 text-[10.5px] font-bold ${
                                m.propio ? "text-right text-white/85" : ""
                              }`}
                              style={m.propio ? undefined : { color: c }}
                            >
                              {nombreCorto(m.autor)}
                            </div>
                          ) : null}
                          {m.cita ? (
                            <div
                              className={`mb-1 rounded-lg border-l-2 px-2 py-1 text-[11px] ${
                                m.propio
                                  ? "border-white/50 bg-white/15 text-white/85"
                                  : "border-[#4FAEB2] bg-slate-50 text-slate-500"
                              }`}
                            >
                              <span className="block font-semibold">{nombreCorto(m.cita.autor)}</span>
                              <span className="line-clamp-2">
                                {m.cita.texto ?? "Mensaje eliminado"}
                              </span>
                            </div>
                          ) : null}
                          {m.eliminado ? (
                            <p className="text-[12px] italic opacity-60">Mensaje eliminado</p>
                          ) : editando?.id === m.id ? (
                            <div className="space-y-1.5">
                              <textarea
                                autoFocus
                                rows={2}
                                value={editando.texto}
                                onChange={(e) => setEditando({ id: m.id, texto: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void guardarEdicion();
                                  }
                                  if (e.key === "Escape") setEditando(null);
                                }}
                                className="w-full resize-none rounded-lg px-2 py-1 text-[12.5px] text-slate-800 focus:outline-none"
                              />
                              <div className="flex justify-end gap-2 text-[11px]">
                                <button type="button" onClick={() => setEditando(null)} className="opacity-80">
                                  Cancelar
                                </button>
                                <button type="button" onClick={() => void guardarEdicion()} className="font-bold">
                                  Guardar
                                </button>
                              </div>
                            </div>
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
                            {m.pendiente ? "enviando… " : m.editado_at ? "editado · " : ""}
                            {m.pendiente ? "" : hora(m.created_at)}
                          </div>

                          {Object.keys(m.reacciones).length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {Object.entries(m.reacciones).map(([emoji, quienes]) => {
                                const nombres = (m.reacciones_nombres?.[emoji] ?? []).map((n) =>
                                  nombreCorto(n)
                                );
                                return (
                                  <span key={emoji} className="group/reac relative">
                                    <button
                                      type="button"
                                      onClick={() => void reaccionar(m.id, emoji)}
                                      // `title` como respaldo: si el hover del
                                      // globito no llega, el navegador lo dice igual.
                                      title={nombres.join(", ")}
                                      className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-none transition-colors ${
                                        m.propio
                                          ? "bg-white/25 hover:bg-white/35"
                                          : "bg-slate-100 hover:bg-slate-200"
                                      }`}
                                    >
                                      {emoji}
                                      <span className="text-[9.5px] font-semibold">
                                        {quienes.length}
                                      </span>
                                    </button>
                                    {nombres.length > 0 ? (
                                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-800 px-2 py-1 text-[10.5px] font-medium text-white shadow-lg group-hover/reac:block">
                                        {emoji} {nombres.join(", ")}
                                      </span>
                                    ) : null}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>

                        {/* Acciones: aparecen al pasar el mouse, para no
                            competir con el texto en reposo. */}
                        {!m.eliminado && !enBusqueda && !m.pendiente ? (
                          <div className="flex items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100">
                            <div className="flex items-center rounded-full border border-slate-200 bg-white px-1 py-0.5 shadow-sm">
                              {EMOJIS.map((e) => (
                                <button
                                  key={e}
                                  type="button"
                                  onClick={() => void reaccionar(m.id, e)}
                                  title={`Reaccionar ${e}`}
                                  className="px-0.5 text-[13px] leading-none transition-transform hover:scale-125"
                                >
                                  {e}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => setCitando(m)}
                              title="Responder"
                              className="rounded-full border border-slate-200 bg-white p-1 text-slate-500 shadow-sm hover:text-[#4FAEB2]"
                            >
                              <Reply className="h-3 w-3" />
                            </button>
                            {m.propio ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditando({ id: m.id, texto: m.texto ?? "" })}
                                  title="Editar"
                                  className="rounded-full border border-slate-200 bg-white p-1 text-slate-500 shadow-sm hover:text-[#4FAEB2]"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void borrarMensaje(m.id)}
                                  title="Eliminar"
                                  className="rounded-full border border-slate-200 bg-white p-1 text-slate-500 shadow-sm hover:text-rose-600"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={finRef} />
            </div>

            {/* --- Redacción ---------------------------------------------------- */}
            <div className="border-t border-slate-100 bg-white px-3 py-2.5">
              {citando ? (
                <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-[#4FAEB2] bg-slate-50 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <span className="block text-[10.5px] font-semibold text-[#2F6E71]">
                      Respondiendo a {nombreCorto(citando.autor)}
                    </span>
                    <span className="line-clamp-2 text-[11px] text-slate-500">
                      {citando.texto ?? "Archivo adjunto"}
                    </span>
                  </div>
                  <button type="button" onClick={() => setCitando(null)} aria-label="Cancelar respuesta">
                    <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" />
                  </button>
                </div>
              ) : null}
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
              {/* Una sola caja que contiene todo, en vez de tres controles
                  sueltos: se lee como un lugar donde escribir. */}
              <div className="flex items-end gap-1.5 rounded-2xl border border-slate-200 bg-white px-2 py-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-colors focus-within:border-[#4FAEB2]">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={subiendo}
                  title="Adjuntar archivo"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#2F6E71] disabled:opacity-40"
                >
                  {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </button>
                <div className="relative flex-1">
                {sugeridosMencion.length > 0 ? (
                  <ul className="absolute bottom-full left-0 z-30 mb-1 w-60 overflow-hidden rounded-xl border border-[#4FAEB2]/25 bg-white p-1 shadow-xl">
                    {sugeridosMencion.map((m) => (
                      <li key={m.usuario_id}>
                        <button
                          type="button"
                          // `onMouseDown`: con `onClick` el textarea pierde el
                          // foco antes y el cursor se va a otro lado.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            elegirMencion(m);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-slate-700 hover:bg-slate-50"
                        >
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
                            style={{ background: `${colorDe(m.nombre)}22`, color: colorDe(m.nombre) }}
                          >
                            {inicialesNombre(m.nombre)}
                          </span>
                          <span className="min-w-0 truncate">{nombreCapitular(m.nombre)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <textarea
                  ref={areaRef}
                  rows={1}
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value);
                    const at = detectarArroba(e.target.value, e.target.selectionStart ?? 0);
                    setConsultaMencion(at ? at.frag : null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && consultaMencion != null) {
                      e.preventDefault();
                      setConsultaMencion(null);
                      return;
                    }
                    // Con el menú abierto, Enter elige la sugerencia.
                    if (e.key === "Enter" && !e.shiftKey && sugeridosMencion.length > 0) {
                      e.preventDefault();
                      elegirMencion(sugeridosMencion[0]);
                      return;
                    }
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
                  placeholder="Escribí un mensaje… · @ para mencionar"
                  className="max-h-32 min-h-[32px] w-full resize-none bg-transparent px-1 py-1.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
                </div>
                <button
                  type="button"
                  onClick={alternarGrabacion}
                  title={grabando ? "Detener y enviar audio" : "Grabar audio"}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                    grabando
                      ? "animate-pulse bg-rose-50 text-rose-600"
                      : "text-slate-400 hover:bg-slate-100 hover:text-[#2F6E71]"
                  }`}
                >
                  {grabando ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
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

      {/* --- Acerca del chat ---------------------------------------------------
          Columna de tarjetas sobre fondo gris: cada bloque se lee solo, y lo
          que no hay simplemente no ocupa lugar. */}
      {panel && salaActual ? (
        <aside
          className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 ${
            mobile ? "absolute inset-0 z-20" : "ml-3 w-80 shrink-0"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-3">
            <button
              type="button"
              onClick={() => setPanel(null)}
              aria-label="Cerrar el panel"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
            <h3 className="text-[14px] font-semibold text-slate-800">Acerca del chat</h3>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {/* Identidad */}
            <div className="rounded-2xl bg-white p-4 text-center shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
              <span
                className="mx-auto flex h-20 w-20 items-center justify-center rounded-full text-[22px] font-bold"
                style={{
                  background: `${colorDe(salaActual.nombre)}22`,
                  color: colorDe(salaActual.nombre),
                }}
              >
                {salaActual.tipo === "grupo" ? (
                  <Users className="h-8 w-8" />
                ) : (
                  inicialesNombre(salaActual.nombre)
                )}
              </span>
              <p className="mt-2.5 text-[15px] font-semibold text-slate-800">
                {nombreCapitular(salaActual.nombre)}
              </p>
              <p className="text-[12px] text-slate-400">
                {salaActual.tipo === "grupo"
                  ? `Grupo · ${salaActual.miembros} integrantes`
                  : "Conversación directa"}
              </p>
              {salaActual.tipo === "grupo" ? (
                <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
                  {salaActual.miembros_nombres.map((n) => nombreCapitular(n)).join(" · ")}
                </p>
              ) : null}
            </div>

            {/* Resumen de lo compartido */}
            <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
              {(
                [
                  { icono: <FileText className="h-4 w-4" />, txt: "Documentos", n: biblioteca?.archivos.length },
                  { icono: <ImageIcon className="h-4 w-4" />, txt: "Imágenes", n: biblioteca?.imagenes.length },
                  { icono: <Mic className="h-4 w-4" />, txt: "Audios", n: biblioteca?.audios.length },
                  { icono: <Link2 className="h-4 w-4" />, txt: "Enlaces", n: biblioteca?.enlaces.length },
                ] as const
              ).map((f) => (
                <div
                  key={f.txt}
                  className="flex items-center gap-2.5 border-b border-slate-50 px-4 py-2.5 last:border-0"
                >
                  <span className="text-[#4FAEB2]">{f.icono}</span>
                  <span className="flex-1 text-[13px] font-medium text-slate-700">{f.txt}</span>
                  <span className="min-w-[22px] rounded-full bg-slate-100 px-1.5 py-0.5 text-center text-[11px] font-semibold text-slate-500">
                    {cargandoBiblio ? "…" : f.n ?? 0}
                  </span>
                </div>
              ))}
            </div>

            {cargandoBiblio && !biblioteca ? (
              <p className="px-1 text-[12px] text-slate-400">Cargando…</p>
            ) : null}

            {/* Imágenes */}
            {biblioteca && biblioteca.imagenes.length > 0 ? (
              <div className="rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                <p className="mb-2 text-[13px] font-semibold text-slate-800">
                  Archivos y contenido multimedia
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {biblioteca.imagenes.slice(0, 12).map((a) =>
                    a.url ? (
                      <a
                        key={a.path}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        title={`${a.nombre} · ${nombreCorto(a.autor)}`}
                        className="aspect-square overflow-hidden rounded-lg bg-slate-100"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={a.url}
                          alt={a.nombre}
                          className="h-full w-full object-cover transition-transform hover:scale-105"
                        />
                      </a>
                    ) : null
                  )}
                </div>
              </div>
            ) : null}

            {/* Documentos y audios */}
            {biblioteca && biblioteca.archivos.length + biblioteca.audios.length > 0 ? (
              <div className="rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                <p className="mb-2 text-[13px] font-semibold text-slate-800">Documentos</p>
                <ul className="space-y-1">
                  {[...biblioteca.archivos, ...biblioteca.audios].map((a) => (
                    <li key={a.path}>
                      <a
                        href={a.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-slate-50"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#2F6E71]">
                          {a.mime_type.startsWith("audio/") ? (
                            <Mic className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-slate-700">
                            {a.nombre}
                          </span>
                          <span className="block truncate text-[10.5px] text-slate-400">
                            {pesoLegible(a.size_bytes)} · {nombreCorto(a.autor)} ·{" "}
                            {fechaCorta(a.created_at)}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Enlaces */}
            {biblioteca && biblioteca.enlaces.length > 0 ? (
              <div className="rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                <p className="mb-2 text-[13px] font-semibold text-slate-800">Enlaces</p>
                <ul className="space-y-1">
                  {biblioteca.enlaces.map((e, i) => (
                    <li key={`${e.url}-${i}`}>
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-slate-50"
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#2F6E71]">
                          <Link2 className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-[#2F6E71]">
                            {e.dominio}
                          </span>
                          <span className="block truncate text-[10.5px] text-slate-400">
                            {e.url}
                          </span>
                          <span className="block text-[10.5px] text-slate-400">
                            {nombreCorto(e.autor)} · {fechaCorta(e.created_at)}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {biblioteca &&
            biblioteca.imagenes.length +
              biblioteca.archivos.length +
              biblioteca.audios.length +
              biblioteca.enlaces.length ===
              0 ? (
              <p className="px-1 text-[12px] leading-relaxed text-slate-400">
                Todavía no se compartió ningún archivo ni enlace en esta conversación.
              </p>
            ) : null}

            {biblioteca?.truncado ? (
              <p className="px-1 text-[11px] leading-relaxed text-slate-400">
                Se muestran los archivos y enlaces de los mensajes más recientes.
              </p>
            ) : null}
          </div>
        </aside>
      ) : null}

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
