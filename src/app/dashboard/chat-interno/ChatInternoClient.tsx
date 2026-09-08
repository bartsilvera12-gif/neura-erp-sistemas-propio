"use client";

/**
 * Chat interno del equipo.
 *
 * Dos paneles: la bandeja de salas a la izquierda y la conversación a la
 * derecha. Los mensajes nuevos llegan por Realtime sobre `chat_interno_mensajes`,
 * el mismo mecanismo que ya usan Conversaciones y la tarjeta de proyecto.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Camera,
  Check,
  CheckCheck,
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileType,
  FileVideo,
  Play,
  Crown,
  UserMinus,
  UserPlus,
  MessagesSquare,
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
import {
  CANAL_AVISOS,
  EVENTO_CHAT_LEIDO,
  EVENTO_CHAT_NOVEDAD,
} from "@/components/layout/ChatPestanaBadge";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { autenticarRealtime } from "@/lib/realtime/autenticar";
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
  /** La cara de la otra persona en un directo, o la foto del grupo. */
  avatar_url: string | null;
  descripcion: string | null;
  /** Cargo de la otra persona, o cuántos son: se muestra si no hay mensajes. */
  subtitulo: string;
  /** Mi rol EN ESTA sala: sólo un `admin` edita el grupo. */
  mi_rol: string;
};

type Adjunto = {
  path: string;
  nombre: string;
  mime_type: string;
  size_bytes: number;
  clase: "audio" | "imagen" | "video" | "archivo";
  url?: string | null;
};

type TipoAdjunto = "imagen" | "video" | "audio" | "pdf" | "archivo";

/**
 * Qué es un adjunto, mirando su mime y no la `clase` guardada.
 *
 * Los mensajes viejos se guardaron cuando "video" todavía no existía como
 * categoría: deducirlo en cada render hace que también ellos se vean bien, sin
 * tener que reescribir nada en la base.
 */
function tipoDe(a: { mime_type?: string | null; nombre?: string | null }): TipoAdjunto {
  const mime = (a.mime_type ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "imagen";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || (a.nombre ?? "").toLowerCase().endsWith(".pdf")) return "pdf";
  return "archivo";
}

/** Se abre dentro del chat, sin descargar nada. */
function seVeEnGrande(a: { mime_type?: string | null; nombre?: string | null }): boolean {
  const t = tipoDe(a);
  return t === "imagen" || t === "video" || t === "pdf";
}

/**
 * El ícono y el color de un archivo, por su tipo.
 *
 * Un PDF rojo y una planilla verde se reconocen antes de leer el nombre, que
 * además suele venir cortado.
 */
function pintaDeArchivo(a: { mime_type?: string | null; nombre?: string | null }): {
  Icono: LucideIcon;
  color: string;
  fondo: string;
} {
  const nombre = (a.nombre ?? "").toLowerCase();
  const mime = (a.mime_type ?? "").toLowerCase();
  const term = (...ext: string[]) => ext.some((e) => nombre.endsWith(e));

  if (tipoDe(a) === "pdf") return { Icono: FileText, color: "#DC2626", fondo: "#FEE2E2" };
  if (term(".xlsx", ".xls", ".csv") || mime.includes("spreadsheet"))
    return { Icono: FileSpreadsheet, color: "#15803D", fondo: "#DCFCE7" };
  if (term(".doc", ".docx") || mime.includes("wordprocessing"))
    return { Icono: FileType, color: "#1D4ED8", fondo: "#DBEAFE" };
  if (term(".zip", ".rar", ".7z", ".tar", ".gz"))
    return { Icono: FileArchive, color: "#B45309", fondo: "#FEF3C7" };
  if (tipoDe(a) === "video") return { Icono: FileVideo, color: "#7C3AED", fondo: "#EDE9FE" };
  if (tipoDe(a) === "audio") return { Icono: FileAudio, color: "#0E7490", fondo: "#CFFAFE" };
  return { Icono: FileIcon, color: "#475569", fondo: "#E2E8F0" };
}

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
  autor_avatar: string | null;
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
  /** Y con cara: en la pastilla se ve quién reaccionó sin abrir nada. */
  reacciones_avatares: Record<string, (string | null)[]>;
  /** El visto, sólo en lo propio: cuántos de cuántos ya lo leyeron. */
  leido_por: number;
  destinatarios: number;
  leido_por_nombres: string[];
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
/**
 * Trama del fondo: una retícula de puntos muy finos.
 *
 * Antes eran iconitos de chat. Cumplían, pero un dibujo reconocible pide ser
 * mirado, y el fondo de una conversación no es para mirarlo: es para que el
 * blanco de los globos tenga contra qué apoyarse. Un punto no representa nada,
 * así que da textura sin robar atención.
 */
const TRAMA_PUNTOS =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Ccircle cx='1.5' cy='1.5' r='1.1' fill='%232F6E71' fill-opacity='0.13'/%3E%3C/svg%3E\")";

/**
 * El fondo completo: dos halos de marca muy tenues sobre un gris cálido, con
 * la trama encima.
 *
 * Los halos son lo que evita que se vea plano —le dan profundidad sin dibujar
 * nada— y van al 8 %, por debajo del umbral en que un fondo empieza a competir
 * con lo que tiene delante. Todo va en `data:` URI y gradientes: ni un pedido
 * de red por la decoración.
 *
 * El contenedor tiene scroll, así que el fondo queda quieto mientras los
 * mensajes pasan por encima: si se moviera con ellos, marearía.
 */
const ESTILO_FONDO: React.CSSProperties = {
  backgroundColor: "#F1F5F4",
  backgroundImage: [
    "radial-gradient(70% 55% at 15% 10%, rgba(79,174,178,0.16), rgba(79,174,178,0) 70%)",
    "radial-gradient(60% 50% at 88% 85%, rgba(47,110,113,0.13), rgba(47,110,113,0) 72%)",
    TRAMA_PUNTOS,
    "linear-gradient(160deg, #F6F9F8 0%, #EFF4F3 55%, #E9F0EF 100%)",
  ].join(", "),
  backgroundRepeat: "no-repeat, no-repeat, repeat, no-repeat",
  backgroundSize: "auto, auto, 22px 22px, cover",
};

/** Verde muy claro para lo propio, igual que en los chats de siempre. */
const BURBUJA_PROPIA = "#E3F3E5";

type UsuarioOpcion = { id: string; nombre: string; area: string; avatar_url: string | null };

type Perfil = {
  usuario_id: string;
  nombre: string;
  nombre_catalogo: string;
  avatar_url: string | null;
};

type MiembroSala = {
  usuario_id: string;
  nombre: string;
  avatar_url: string | null;
  rol: string;
  propio: boolean;
};

/**
 * La cara de una persona: la foto si la cargó, y si no las iniciales de color.
 *
 * Las iniciales no son un placeholder a la espera de la foto — son la identidad
 * por defecto, siempre presentes y siempre legibles.
 */
function Avatar({
  nombre,
  url,
  size = 36,
  icono,
}: {
  nombre: string;
  url?: string | null;
  size?: number;
  icono?: React.ReactNode;
}) {
  const c = colorDe(nombre);
  const px = `${size}px`;
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={nombre}
        style={{ width: px, height: px }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      // Color pleno y no una base translúcida: sobre el patrón del fondo, un
      // avatar semitransparente se lava y deja de leerse como una persona.
      style={{ width: px, height: px, background: c, fontSize: size * 0.36 }}
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    >
      {icono ?? inicialesNombre(nombre)}
    </span>
  );
}

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

/**
 * Resumen barato de la lista, para saber si cambió algo.
 *
 * Incluye lo que se ve: el id, si se editó o borró, las reacciones y el visto.
 * Comparar los objetos enteros sería más caro que volver a renderizar.
 */
function firmaDeMensajes(ms: Mensaje[]): string {
  return ms
    .map(
      (m) =>
        `${m.id}|${m.editado_at ?? ""}|${m.eliminado ? 1 : 0}|${m.leido_por}|${JSON.stringify(
          m.reacciones
        )}`
    )
    .join(",");
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
/**
 * El visto de un mensaje propio.
 *
 * Un tilde = salió. Dos grises = alguien lo leyó, pero no todos. Dos en color
 * = lo leyeron todos. En un directo "todos" es una sola persona, así que se
 * comporta igual que el de siempre; en un grupo, el estado intermedio es la
 * información que importa, y por eso no se colapsa a leído/no leído.
 */
function Visto({
  leidoPor,
  destinatarios,
  nombres,
}: {
  leidoPor: number;
  destinatarios: number;
  nombres: string[];
}) {
  if (destinatarios === 0) return null;
  const todos = leidoPor >= destinatarios;
  const titulo =
    leidoPor === 0
      ? "Todavía no lo leyó nadie"
      : `Leído por ${nombres.map((n) => nombreCorto(n)).join(", ")}${
          todos ? "" : ` · faltan ${destinatarios - leidoPor}`
        }`;
  return (
    <span title={titulo} className="inline-flex translate-y-[2px] align-baseline">
      {leidoPor === 0 ? (
        <Check className="h-3.5 w-3.5 text-slate-400" strokeWidth={2.5} />
      ) : (
        <CheckCheck
          className={`h-3.5 w-3.5 ${todos ? "text-[#2F9BD8]" : "text-slate-400"}`}
          strokeWidth={2.5}
        />
      )}
    </span>
  );
}

/**
 * Un adjunto dentro del globo.
 *
 * Cada tipo se muestra como corresponde: la imagen y el video se ven ahí
 * mismo, el audio se escucha, y lo demás es una tarjeta con el ícono de su
 * clase. Mostrar todo como un enlace gris obliga a descargar para saber qué es.
 */
function Adjuntito({
  a,
  onVer,
  onDescargar,
}: {
  a: Adjunto;
  onVer: () => void;
  onDescargar: () => void;
}) {
  const tipo = tipoDe(a);

  if (tipo === "audio" && a.url) {
    return <audio controls src={a.url} className="h-9 w-60 max-w-full" />;
  }

  if ((tipo === "imagen" || tipo === "video") && a.url) {
    return (
      // Las acciones aparecen encima al pasar el mouse, para no tapar la
      // imagen mientras se la mira.
      <div className="group/img relative inline-block">
        <button type="button" onClick={onVer} title="Ver más grande" className="block">
          {tipo === "imagen" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.url}
              alt={a.nombre}
              className="max-h-64 cursor-zoom-in rounded-lg border border-black/5"
            />
          ) : (
            <span className="relative block">
              <video
                src={a.url}
                // Sin `preload` el recuadro sale negro: hace falta el primer
                // fotograma para que se entienda qué video es.
                preload="metadata"
                className="max-h-64 rounded-lg border border-black/5"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900/55 text-white backdrop-blur-sm">
                  <Play className="ml-0.5 h-5 w-5 fill-white" />
                </span>
              </span>
            </span>
          )}
        </button>
        <span className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover/img:opacity-100">
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            title="Abrir en otra pestaña"
            className="rounded-lg bg-slate-900/60 p-1.5 text-white backdrop-blur-sm hover:bg-slate-900/80"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={onDescargar}
            title="Descargar"
            className="rounded-lg bg-slate-900/60 p-1.5 text-white backdrop-blur-sm hover:bg-slate-900/80"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    );
  }

  const { Icono, color, fondo } = pintaDeArchivo(a);
  const abrible = seVeEnGrande(a) && !!a.url;
  return (
    <div className="flex min-w-[230px] items-center gap-2.5 rounded-lg bg-slate-50 px-2 py-2 text-[12px]">
      <button
        type="button"
        onClick={abrible ? onVer : onDescargar}
        title={abrible ? "Ver" : "Descargar"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: fondo, color }}
      >
        <Icono className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        onClick={abrible ? onVer : onDescargar}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate font-medium text-slate-700">{a.nombre}</span>
        <span className="block text-[10.5px] uppercase text-slate-400">
          {(a.nombre.split(".").pop() ?? "").slice(0, 5)} · {pesoLegible(a.size_bytes)}
        </span>
      </button>
      <a
        href={a.url ?? "#"}
        target="_blank"
        rel="noreferrer"
        title="Abrir en otra pestaña"
        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-[#2F6E71]"
      >
        <ExternalLink className="h-4 w-4" />
      </a>
      <button
        type="button"
        onClick={onDescargar}
        title="Descargar"
        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-[#2F6E71]"
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}

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
  /** Temporizador del buscador: se espera a que deje de tipear. */
  const buscaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Contador de pedidos de mensajes, para descartar respuestas atrasadas. */
  const pedidoRef = useRef(0);
  /** Al abrir una conversación hay que ir al final, no quedarse en el principio. */
  const saltarAlFinalRef = useRef(true);
  /** Mi perfil: el nombre y la foto que ven los demás. */
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  /** Filtro de la bandeja: busca en mis conversaciones Y entre las personas. */
  const [filtroBandeja, setFiltroBandeja] = useState("");
  const [directorio, setDirectorio] = useState<UsuarioOpcion[]>([]);
  /** Edición del grupo: `null` mientras no se esté editando. */
  const [editandoGrupo, setEditandoGrupo] = useState<{
    nombre: string;
    descripcion: string;
  } | null>(null);
  const [guardandoGrupo, setGuardandoGrupo] = useState(false);
  const fotoGrupoRef = useRef<HTMLInputElement>(null);
  const [subiendoFotoGrupo, setSubiendoFotoGrupo] = useState(false);
  /** Alta de integrantes: `null` cerrado. */
  const [sumando, setSumando] = useState<string | null>(null);
  const [tocandoMiembros, setTocandoMiembros] = useState(false);
  /** Edición de mi nombre en el chat: `null` mientras no se edita. */
  const [editandoNombre, setEditandoNombre] = useState<string | null>(null);
  /** Índice dentro de la galería de la conversación. `null` = visor cerrado. */
  const [viendoIdx, setViendoIdx] = useState<number | null>(null);
  /** Quién está escribiendo ahora mismo: nombre por usuario. */
  const [escribiendo, setEscribiendo] = useState<Record<string, string>>({});
  /** El canal de la sala abierta, para poder avisar por él. */
  const canalRef = useRef<RealtimeChannel | null>(null);
  /** Último aviso de "estoy escribiendo": se manda cada tanto, no por tecla. */
  const ultimoAvisoRef = useRef(0);
  /** Canal común, para avisar a quien NO tiene esta conversación abierta. */
  const avisosRef = useRef<RealtimeChannel | null>(null);
  const [abriendoDirecto, setAbriendoDirecto] = useState<string | null>(null);
  /** Alto real disponible: se mide, no se adivina con un `calc` fijo. */
  const contRef = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState<number | null>(null);
  /** Miembros de la sala abierta: alimentan el menú de menciones. */
  const [miembrosSala, setMiembrosSala] = useState<MiembroSala[]>([]);

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
  const [descGrupo, setDescGrupo] = useState("");
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
    // Al cambiar rápido de conversación, la respuesta de la anterior puede
    // llegar después que la de la nueva y pisarla. Se descarta la que ya no
    // corresponde a la sala abierta.
    const miPedido = ++pedidoRef.current;
    const vigente = () => miPedido === pedidoRef.current;
    try {
      const qs = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${id}/mensajes${qs}`, {
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as {
        data?: { mensajes?: Mensaje[]; escribiendo?: string[] };
      };
      if (!vigente()) return;
      const llegaron = j?.data?.mensajes ?? [];
      // Buscar es otra vista: ahí el cartel de "escribiendo" no viene al caso.
      if (!q) {
        // La clave es el nombre: si la misma persona llega por los dos
        // caminos, la segunda pisa a la primera en vez de sumarse.
        const quienes = j?.data?.escribiendo ?? [];
        setEscribiendo(Object.fromEntries(quienes.map((n) => [n, n])));
      }
      // Los pendientes se conservan hasta que el servidor los devuelva: si no,
      // el mensaje recien escrito parpadearia y desapareceria.
      setMensajes((prev) => {
        const confirmados = new Set(llegaron.map((m) => m.id));
        const enVuelo = prev.filter((m) => m.pendiente && !confirmados.has(m.id));
        const nuevos = [...llegaron, ...enVuelo];
        // Si es lo mismo que ya está en pantalla, se deja la lista anterior:
        // reemplazarla por una copia idéntica vuelve a renderizar todo y
        // mueve el scroll cada tres segundos.
        return firmaDeMensajes(prev) === firmaDeMensajes(nuevos) ? prev : nuevos;
      });
      // Buscar no es leer la conversación: no marca nada como visto.
      if (!q) {
        void fetchWithSupabaseSession(`/api/chat-interno/salas/${id}/leido`, {
          method: "POST",
        }).then(() => {
          // Que el contador de la pestaña baje ahora y no en el próximo
          // refresco: leer una sala tiene que verse en el acto.
          window.dispatchEvent(new Event(EVENTO_CHAT_LEIDO));
          // Y que al otro se le ponga el visto en azul sin esperar nada.
          void canalRef.current?.send({ type: "broadcast", event: "leido", payload: {} });
        });
        setSalas((prev) => prev.map((s) => (s.id === id ? { ...s, no_leidos: 0 } : s)));
      }
    } finally {
      if (!silencioso && vigente()) setCargandoMsgs(false);
    }
  }, []);

  useEffect(() => {
    void cargarSalas();
  }, [cargarSalas]);

  /**
   * El chat ocupa todo lo que sobra hasta el pie de la ventana.
   *
   * Se mide la distancia real desde el borde superior del contenedor en vez de
   * restar una constante: la barra de arriba cambia de alto entre pantallas, y
   * un `calc` fijo deja hueco muerto en unas y corta en otras.
   */
  useEffect(() => {
    const medir = () => {
      const el = contRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setAlto(Math.max(360, Math.round(window.innerHeight - top - 16)));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [acceso]);

  const yaElegi = useRef(false);
  useEffect(() => {
    if (yaElegi.current || salaId || salas.length === 0) return;

    // `?sala=` viene de la campanita: se entra a LA conversación del aviso.
    // Vale también en mobile, donde normalmente no se abre ninguna sola:
    // acá la persona pidió explícitamente esa conversación.
    const pedida = new URLSearchParams(window.location.search).get("sala");
    if (pedida && salas.some((s) => s.id === pedida)) {
      yaElegi.current = true;
      setSalaId(pedida);
      // Se limpia la URL: al recargar más tarde, esa sala ya no es "la del
      // aviso" y volver a abrirla sería una sorpresa.
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (mobile) return;
    yaElegi.current = true;
    setSalaId(salas[0].id);
  }, [salas, salaId, mobile]);

  // Mi perfil y el directorio de la empresa: se cargan una vez.
  useEffect(() => {
    if (acceso !== "ok") return;
    void (async () => {
      const [rp, ru] = await Promise.all([
        fetchWithSupabaseSession("/api/chat-interno/perfil", { cache: "no-store" }),
        fetchWithSupabaseSession("/api/chat-interno/usuarios", { cache: "no-store" }),
      ]);
      const jp = (await rp.json().catch(() => ({}))) as { data?: Perfil };
      const ju = (await ru.json().catch(() => ({}))) as { data?: { usuarios?: UsuarioOpcion[] } };
      setPerfil(jp?.data ?? null);
      setDirectorio(ju?.data?.usuarios ?? []);
    })();
  }, [acceso]);

  useEffect(() => {
    // Se vacía ANTES de pedir. Si no, la cabecera ya muestra a la persona
    // nueva mientras abajo siguen los mensajes de la conversación anterior:
    // durante ese rato la pantalla está diciendo algo que no es cierto.
    setMensajes([]);
    setEscribiendo({});
    saltarAlFinalRef.current = true;
    if (salaId) {
      setCargandoMsgs(true);
      void cargarMensajes(salaId);
    }
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
        const j = (await r.json().catch(() => ({}))) as { data?: { miembros?: MiembroSala[] } };
        if (!cancel) setMiembrosSala(j?.data?.miembros ?? []);
      })
      .catch(() => {
        if (!cancel) setMiembrosSala([]);
      });
    return () => {
      cancel = true;
    };
  }, [salaId]);

  /**
   * El canal de la sala abierta.
   *
   * Va por DOS caminos a la vez, y no por gusto:
   *
   *  · `postgres_changes` lee la replicación de Postgres. Es el camino correcto
   *    —lo que se guardó es lo que se avisa— pero depende de que la tabla esté
   *    publicada, de RLS, y de que el socket esté autenticado.
   *  · `broadcast` es un mensaje directo entre navegadores. No toca la base, así
   *    que llega siempre y llega antes.
   *
   * Los dos disparan lo mismo —volver a pedir— y pedir de más es inofensivo.
   * Con uno solo, cualquier problema de infraestructura deja el chat mudo, que
   * es de donde venimos.
   */
  useEffect(() => {
    if (!salaId) return;
    let vivo = true;
    let canal: RealtimeChannel | null = null;

    const refrescar = () => {
      void cargarMensajes(salaId, undefined, true);
      void cargarSalas();
    };

    void (async () => {
      // Sin esto el canal se une con el token anónimo y RLS no deja pasar nada.
      await autenticarRealtime(supabase);
      if (!vivo) return;

      canal = supabase
        .channel(`chat-interno-${salaId}`, { config: { broadcast: { self: false } } })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "neura",
            table: "chat_interno_mensajes",
            filter: `sala_id=eq.${salaId}`,
          },
          refrescar
        )
        // Cuando el otro lee, el visto tiene que ponerse en azul solo. La
        // lectura se guarda en `miembros` y no en el mensaje.
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "neura",
            table: "chat_interno_miembros",
            filter: `sala_id=eq.${salaId}`,
          },
          () => void cargarMensajes(salaId, undefined, true)
        )
        .on("broadcast", { event: "mensaje" }, refrescar)
        .on("broadcast", { event: "leido" }, () =>
          void cargarMensajes(salaId, undefined, true)
        )
        .on("broadcast", { event: "escribiendo" }, ({ payload }) => {
          const p = payload as { usuario_id?: string; nombre?: string };
          if (!p?.usuario_id || !p.nombre) return;
          setEscribiendo((prev) => ({ ...prev, [p.nombre!]: p.nombre! }));
          // Se apaga sola: quien cierra la pestaña a mitad de una palabra no
          // manda ningún "ya no escribo", y el cartel quedaría para siempre.
          window.setTimeout(() => {
            setEscribiendo((prev) => {
              if (!(p.nombre! in prev)) return prev;
              const resto = { ...prev };
              delete resto[p.nombre!];
              return resto;
            });
          }, 4000);
        })
        .subscribe();

      canalRef.current = canal;
    })();

    return () => {
      vivo = false;
      canalRef.current = null;
      setEscribiendo({});
      if (canal) void supabase.removeChannel(canal);
    };
  }, [salaId, cargarMensajes, cargarSalas]);

  /**
   * Bajar al último mensaje.
   *
   * Dos casos distintos, y se comportan distinto a propósito:
   *
   *  · Al ABRIR una conversación se salta al final de una, sin animación. Una
   *    conversación se abre para ver lo último, no para leerla desde el
   *    principio como un libro.
   *  · Con un mensaje NUEVO se baja sólo si ya se estaba mirando el final: a
   *    quien subió a leer algo viejo, arrastrarlo al pie le hace perder el
   *    lugar justo cuando estaba leyendo.
   */
  const ultimoId = mensajes.length > 0 ? mensajes[mensajes.length - 1].id : "";
  useEffect(() => {
    if (!ultimoId) return;

    if (saltarAlFinalRef.current) {
      saltarAlFinalRef.current = false;
      const alFondo = () => finRef.current?.scrollIntoView({ behavior: "auto" });
      alFondo();
      // Otra vez un instante después: las imágenes y los adjuntos todavía no
      // midieron, y al hacerlo el final se corre más abajo.
      const t = window.setTimeout(alFondo, 120);
      return () => window.clearTimeout(t);
    }

    const cont = finRef.current?.parentElement;
    const cerca = !cont || cont.scrollHeight - cont.scrollTop - cont.clientHeight < 220;
    if (cerca) finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ultimoId]);

  /**
   * Todo lo que se puede mirar en grande en esta conversación, en orden.
   *
   * El visor navega sobre esta lista y no sobre un solo archivo: abrir una foto
   * y tener que cerrarla para ver la siguiente es lo que hace que revisar lo
   * que se mandó sea tedioso.
   */
  const galeria = useMemo(
    () => mensajes.flatMap((m) => m.adjuntos.filter((a) => seVeEnGrande(a) && a.url)),
    [mensajes]
  );
  const viendo = viendoIdx !== null ? galeria[viendoIdx] ?? null : null;

  function abrirVisor(a: Adjunto) {
    const i = galeria.findIndex((x) => x.path === a.path);
    setViendoIdx(i >= 0 ? i : null);
    if (i < 0 && a.url) window.open(a.url, "_blank", "noopener");
  }

  const mover = useCallback(
    (paso: number) => {
      setViendoIdx((i) => {
        if (i === null || galeria.length === 0) return i;
        // Da la vuelta: llegar al final y quedarse trabado no ayuda a nadie.
        return (i + paso + galeria.length) % galeria.length;
      });
    },
    [galeria.length]
  );

  // Escape cierra y las flechas recorren: es lo que hace cualquiera sin pensarlo.
  useEffect(() => {
    if (viendoIdx === null) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViendoIdx(null);
      if (e.key === "ArrowRight") mover(1);
      if (e.key === "ArrowLeft") mover(-1);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [viendoIdx, mover]);

  /**
   * Red de seguridad: con el chat abierto y a la vista, se pregunta cada 20 s.
   *
   * Los mensajes llegan por Realtime, que ya funciona. Esto sólo cubre el caso
   * de que el socket se caiga sin avisar —pasa: una red que se corta, una
   * suspensión del equipo—, y ahí veinte segundos de atraso es un mal momento,
   * no una conversación rota. Cuando se preguntaba cada 3 s era porque el
   * Realtime no llegaba: eso ya se arregló en el proxy.
   *
   * Sólo con la pestaña visible: una pestaña de fondo no le muestra nada a
   * nadie, y preguntar ahí es gastar por gusto.
   */
  useEffect(() => {
    if (!salaId || enBusqueda) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void cargarMensajes(salaId, undefined, true);
    }, 20000);
    const alVolver = () => {
      if (document.visibilityState === "visible") {
        void cargarMensajes(salaId, undefined, true);
        void cargarSalas();
      }
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [salaId, enBusqueda, cargarMensajes, cargarSalas]);

  /** La bandeja, más espaciada todavía: cambia menos y pesa más. */
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void cargarSalas();
    }, 30000);
    return () => clearInterval(t);
  }, [cargarSalas]);

  /**
   * El canal común de avisos, y el rebote del contador de la pestaña.
   *
   * Sirve para las dos direcciones: por acá se avisa cuando uno escribe, y por
   * acá llega la novedad de una conversación que no es la que está abierta —
   * que es justo la que antes tardaba hasta media hora en aparecer.
   */
  useEffect(() => {
    if (acceso !== "ok") return;
    let vivo = true;
    let canal: RealtimeChannel | null = null;
    void (async () => {
      await autenticarRealtime(supabase);
      if (!vivo) return;
      canal = supabase
        .channel(CANAL_AVISOS, { config: { broadcast: { self: false } } })
        .subscribe();
      avisosRef.current = canal;
    })();

    const alHaberNovedad = (e: Event) => {
      const sala = (e as CustomEvent<{ sala_id?: string }>).detail?.sala_id;
      void cargarSalas();
      if (sala && sala === salaIdRef.current) {
        void cargarMensajes(sala, undefined, true);
      }
    };
    window.addEventListener(EVENTO_CHAT_NOVEDAD, alHaberNovedad);

    return () => {
      vivo = false;
      avisosRef.current = null;
      window.removeEventListener(EVENTO_CHAT_NOVEDAD, alHaberNovedad);
      if (canal) void supabase.removeChannel(canal);
    };
  }, [acceso, cargarSalas, cargarMensajes]);

  /** La sala abierta, para leerla desde un manejador que no se vuelve a crear. */
  const salaIdRef = useRef<string | null>(null);
  useEffect(() => {
    salaIdRef.current = salaId;
  }, [salaId]);

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
    setEditandoGrupo(null);
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

  /**
   * Reaccionar, de verdad al instante.
   *
   * El cambio se pinta ANTES de salir a la red y el servidor sólo confirma:
   * esperar el ida y vuelta para ver tu propio 👍 se siente roto. Si falla, se
   * vuelve a lo que decía el servidor.
   */
  async function reaccionar(msgId: string, emoji: string) {
    const yoId = perfil?.usuario_id ?? "";
    const yoNombre = perfil?.nombre ?? "Yo";
    const yoFoto = perfil?.avatar_url ?? null;
    const antes = mensajes;

    setMensajes((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const quienes = m.reacciones[emoji] ?? [];
        const yaEstaba = quienes.includes(yoId);
        const nuevos = yaEstaba ? quienes.filter((u) => u !== yoId) : [...quienes, yoId];

        const reacciones = { ...m.reacciones };
        const nombres = { ...m.reacciones_nombres };
        const caras = { ...m.reacciones_avatares };
        if (nuevos.length === 0) {
          delete reacciones[emoji];
          delete nombres[emoji];
          delete caras[emoji];
        } else {
          reacciones[emoji] = nuevos;
          nombres[emoji] = yaEstaba
            ? (nombres[emoji] ?? []).filter((n) => n !== yoNombre)
            : [...(nombres[emoji] ?? []), yoNombre];
          caras[emoji] = yaEstaba
            ? (caras[emoji] ?? []).slice(0, nuevos.length)
            : [...(caras[emoji] ?? []), yoFoto];
        }
        return { ...m, reacciones, reacciones_nombres: nombres, reacciones_avatares: caras };
      })
    );

    try {
      const r = await fetchWithSupabaseSession(`/api/chat-interno/mensajes/${msgId}/reaccion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!r.ok) setMensajes(antes);
    } catch {
      setMensajes(antes);
    }
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
    // Se marca en la lista que ya está en pantalla; recargar la conversación
    // entera para tachar un renglón es traer todo de nuevo por nada.
    setMensajes((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, eliminado: true, texto: null, adjuntos: [] } : m))
    );
    void cargarSalas();
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
          .filter((m) => !m.propio)
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
      usuario_id: perfil?.usuario_id ?? null,
      autor: perfil?.nombre ?? "Yo",
      texto: cuerpo.trim() || null,
      adjuntos: files,
      created_at: new Date().toISOString(),
      editado_at: null,
      eliminado: false,
      propio: true,
      responde_a: responde?.id ?? null,
      cita: responde ? { autor: responde.autor, texto: responde.texto } : null,
      autor_avatar: perfil?.avatar_url ?? null,
      reacciones: {},
      reacciones_nombres: {},
      reacciones_avatares: {},
      leido_por: 0,
      destinatarios: 0,
      leido_por_nombres: [],
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
      // Aviso directo a quien tenga la sala abierta. Llega antes que la
      // replicación y no depende de ella.
      void canalRef.current?.send({ type: "broadcast", event: "mensaje", payload: {} });
      // Y al resto, que puede tener otra conversación abierta o ninguna.
      void avisosRef.current?.send({
        type: "broadcast",
        event: "mensaje",
        payload: { sala_id: salaId },
      });
      // Al mandar dejo de estar escribiendo; el cartel del otro lado se apaga
      // solo, pero que se apague al ver llegar el mensaje es lo natural.
      ultimoAvisoRef.current = 0;
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

  /**
   * Descarga con el nombre real del archivo.
   *
   * Un `<a download>` apuntando a la URL firmada no alcanza: el atributo se
   * ignora cuando el archivo vive en otro origen, y el navegador termina
   * abriéndolo o guardándolo con el nombre codificado del storage. Así que se
   * baja a memoria y se guarda desde acá.
   */
  async function descargar(a: Adjunto) {
    if (!a.url) return;
    try {
      const r = await fetch(a.url);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.nombre || "archivo";
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Se libera después: revocarla en el mismo tick cancela la descarga.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // Si algo falla, al menos que pueda verlo.
      window.open(a.url, "_blank", "noopener");
    }
  }

  /**
   * Avisa que estoy escribiendo, como mucho una vez cada dos segundos.
   *
   * Mandarlo por tecla sería una ráfaga de avisos por cada palabra, y el cartel
   * del otro lado se ve igual.
   */
  function avisarQueEscribo() {
    const canal = canalRef.current;
    if (!perfil) return;
    const ahora = Date.now();
    if (ahora - ultimoAvisoRef.current < 2000) return;
    ultimoAvisoRef.current = ahora;
    void canal?.send({
      type: "broadcast",
      event: "escribiendo",
      payload: { usuario_id: perfil.usuario_id, nombre: perfil.nombre },
    });
  }

  /**
   * El mismo aviso, por el camino que hoy sí llega.
   *
   * Deja una marca en la sala; quien consulta ve quién escribió hace menos de
   * unos segundos. Cuesta un pedido cada dos segundos mientras se escribe, y
   * sólo mientras se escribe.
   */
  function avisarQueEscriboPorApi() {
    if (!salaId) return;
    void fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}/escribiendo`, {
      method: "POST",
    });
  }

  async function cambiarFoto(file: File) {
    setSubiendoFoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetchWithSupabaseSession("/api/chat-interno/perfil", {
        method: "POST",
        body: fd,
      });
      const j = (await r.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        data?: { avatar_url?: string | null };
      };
      if (!r.ok || !j.success) {
        setErr(j.error ?? "No se pudo guardar la foto");
        return;
      }
      setPerfil((p) => (p ? { ...p, avatar_url: j.data?.avatar_url ?? null } : p));
      // La foto vieja sigue pegada en los mensajes ya cargados hasta releerlos.
      if (salaId) void cargarMensajes(salaId, undefined, true);
      void cargarSalas();
    } finally {
      setSubiendoFoto(false);
    }
  }

  async function guardarGrupo() {
    if (!salaId || !editandoGrupo) return;
    if (!editandoGrupo.nombre.trim()) {
      setErr("El grupo necesita un nombre");
      return;
    }
    setGuardandoGrupo(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: editandoGrupo.nombre,
          descripcion: editandoGrupo.descripcion,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setErr(j.error ?? "No se pudo guardar");
        return;
      }
      setEditandoGrupo(null);
      await cargarSalas();
    } finally {
      setGuardandoGrupo(false);
    }
  }

  const recargarMiembros = useCallback(async () => {
    if (!salaId) return;
    const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}/miembros`, {
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as { data?: { miembros?: MiembroSala[] } };
    setMiembrosSala(j?.data?.miembros ?? []);
  }, [salaId]);

  async function tocarMiembros(cambio: {
    agregar?: string[];
    quitar?: string[];
    promover?: string[];
    degradar?: string[];
  }) {
    if (!salaId) return;
    setTocandoMiembros(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}/miembros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambio),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setErr(j.error ?? "No se pudo cambiar los integrantes");
        return;
      }
      // Salir del grupo cierra la conversación: ya no es mía.
      const saliYo = cambio.quitar?.includes(perfil?.usuario_id ?? "");
      if (saliYo) {
        setSalaId(null);
        setPanel(null);
      } else {
        await recargarMiembros();
      }
      await cargarSalas();
    } finally {
      setTocandoMiembros(false);
      setSumando(null);
    }
  }

  async function guardarMiNombre() {
    if (editandoNombre === null) return;
    const r = await fetchWithSupabaseSession("/api/chat-interno/perfil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: editandoNombre }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      data?: { nombre?: string };
    };
    if (!r.ok || !j.success) {
      setErr(j.error ?? "No se pudo guardar el nombre");
      return;
    }
    setPerfil((p) => (p ? { ...p, nombre: j.data?.nombre ?? p.nombre } : p));
    setEditandoNombre(null);
    // Los mensajes ya cargados siguen con el nombre viejo hasta releerlos.
    if (salaId) void cargarMensajes(salaId, undefined, true);
    void cargarSalas();
  }

  async function cambiarFotoGrupo(file: File) {
    if (!salaId) return;
    setSubiendoFotoGrupo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}`, {
        method: "POST",
        body: fd,
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setErr(j.error ?? "No se pudo guardar la foto");
        return;
      }
      await cargarSalas();
    } finally {
      setSubiendoFotoGrupo(false);
    }
  }

  async function quitarFotoGrupo() {
    if (!salaId) return;
    setSubiendoFotoGrupo(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/chat-interno/salas/${salaId}`, {
        method: "DELETE",
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setErr(j.error ?? "No se pudo quitar la foto");
        return;
      }
      await cargarSalas();
    } finally {
      setSubiendoFotoGrupo(false);
    }
  }

  /**
   * Abre la conversación con alguien. Si ya existe se reusa —el servidor no
   * crea un segundo hilo con la misma persona—, y si no, se crea ahí mismo.
   */
  async function abrirDirecto(u: UsuarioOpcion) {
    setAbriendoDirecto(u.id);
    try {
      const r = await fetchWithSupabaseSession("/api/chat-interno/salas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "directo", miembros: [u.id] }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        data?: { id?: string };
      };
      if (!r.ok || !j.success || !j.data?.id) {
        setErr(j.error ?? "No se pudo abrir la conversación");
        return;
      }
      setFiltroBandeja("");
      await cargarSalas();
      setSalaId(j.data.id);
    } finally {
      setAbriendoDirecto(null);
    }
  }

  /** Salir del buscador es volver a la conversación, no sólo vaciar el campo. */
  function cerrarBusqueda() {
    setVerBuscador(false);
    setBusca("");
    if (enBusqueda && salaId) {
      setEnBusqueda(false);
      saltarAlFinalRef.current = true;
      void cargarMensajes(salaId);
    }
  }

  async function abrirModal() {
    setModal(true);
    setNombreGrupo("");
    setDescGrupo("");
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
        descripcion: descGrupo,
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

  // Editar el grupo es de sus administradores. Un directo no se edita: se
  // llama con el nombre de la otra persona y se ve con su cara.
  const puedoEditarGrupo = salaActual?.tipo === "grupo" && salaActual.mi_rol === "admin";

  // Quien todavía no está en el grupo. Ofrecer a alguien que ya está sería
  // ofrecer una acción sin efecto.
  const yaEstan = new Set(miembrosSala.map((m) => m.usuario_id));
  const filtroSuma = (sumando ?? "").trim().toLowerCase();
  const candidatosASumar = filtroSuma
    ? directorio
        .filter((u) => !yaEstan.has(u.id) && u.nombre.toLowerCase().includes(filtroSuma))
        .slice(0, 8)
    : [];

  /**
   * "Juliana está escribiendo…", o quiénes si son varios.
   *
   * Se quitan los repetidos: el aviso llega por dos caminos —el directo entre
   * navegadores y la consulta— y cada uno guarda a la persona con una clave
   * distinta, así que la misma aparecía dos veces.
   *
   * En una conversación de a dos no se dice el nombre: ya se sabe quién es, y
   * repetirlo debajo de su propio nombre no agrega nada.
   */
  const quienesEscriben = (() => {
    const nombres = [...new Set(Object.values(escribiendo).map((n) => nombreCorto(n)))];
    if (nombres.length === 0) return "";
    if (salaActual?.tipo !== "grupo") return "Está escribiendo…";
    if (nombres.length === 1) return `${nombres[0]} está escribiendo…`;
    if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]} están escribiendo…`;
    return "Varios están escribiendo…";
  })();

  const q = filtroBandeja.trim().toLowerCase();
  const salasFiltradas = q
    ? salas.filter(
        (s) =>
          s.nombre.toLowerCase().includes(q) ||
          s.miembros_nombres.some((n) => n.toLowerCase().includes(q))
      )
    : salas;
  // Sólo gente con la que NO hay un directo abierto: si ya lo hay, aparece
  // arriba como conversación y ofrecerla dos veces sería confuso.
  const conDirecto = new Set(
    salas.filter((s) => s.tipo === "directo").map((s) => s.nombre.toLowerCase())
  );
  const personasSugeridas = q
    ? directorio
        .filter((u) => u.nombre.toLowerCase().includes(q))
        .filter((u) => !conDirecto.has(u.nombre.toLowerCase()))
        .slice(0, 8)
    : [];

  const usuariosFiltrados = usuarios.filter((u) =>
    buscaUsuario.trim() ? u.nombre.toLowerCase().includes(buscaUsuario.trim().toLowerCase()) : true
  );

  // En mobile sólo se ve un panel: la conversación si hay una abierta.
  const verBandeja = !mobile || !salaId;
  const verConversacion = !mobile || !!salaId;

  return (
    <div
      ref={contRef}
      style={alto ? { height: `${alto}px` } : undefined}
      className={mobile ? "relative flex min-h-[420px]" : "flex min-h-[480px] gap-3"}
    >
      {/* --- Bandeja ---------------------------------------------------------- */}
      <aside
        className={`${verBandeja ? "flex" : "hidden"} ${
          mobile ? "w-full" : "w-[19rem] shrink-0"
        } flex-col overflow-hidden rounded-2xl border border-[#4FAEB2]/20 bg-white shadow-[0_2px_12px_rgba(47,110,113,0.08)]`}
      >
        {/* Mi perfil. La foto se cambia acá porque acá es donde uno se ve
            como lo ven los demás. */}
        <div className="flex items-center gap-2.5 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-transparent px-3 py-2.5">
          <button
            type="button"
            onClick={() => fotoRef.current?.click()}
            disabled={subiendoFoto}
            title="Cambiar mi foto de perfil"
            className="group/foto relative shrink-0 rounded-full"
          >
            <Avatar nombre={perfil?.nombre ?? "?"} url={perfil?.avatar_url} size={38} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50 opacity-0 transition-opacity group-hover/foto:opacity-100">
              {subiendoFoto ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <Camera className="h-4 w-4 text-white" />
              )}
            </span>
          </button>
          <div className="min-w-0 flex-1">
            {editandoNombre !== null ? (
              <input
                autoFocus
                value={editandoNombre}
                maxLength={60}
                onChange={(e) => setEditandoNombre(e.target.value)}
                onBlur={() => void guardarMiNombre()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void guardarMiNombre();
                  if (e.key === "Escape") setEditandoNombre(null);
                }}
                placeholder={perfil?.nombre_catalogo ?? ""}
                className="w-full rounded-lg border border-[#4FAEB2] px-1.5 py-0.5 text-[13px] font-semibold text-slate-800 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditandoNombre(perfil?.nombre ?? "")}
                title="Cambiar como me ven en el chat"
                className="flex w-full items-center gap-1 text-left"
              >
                <span className="min-w-0 truncate text-[13px] font-semibold text-slate-800">
                  {perfil ? nombreCapitular(perfil.nombre) : "…"}
                </span>
                <Pencil className="h-3 w-3 shrink-0 text-slate-300" />
              </button>
            )}
            <button
              type="button"
              onClick={() => fotoRef.current?.click()}
              className="text-[10.5px] text-slate-400 hover:text-[#2F6E71]"
            >
              {perfil?.avatar_url ? "Cambiar foto" : "Poner una foto"}
            </button>
          </div>
          <button
            type="button"
            onClick={abrirModal}
            title="Nuevo grupo"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#4FAEB2] text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
          </button>
          <input
            ref={fotoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void cambiarFoto(f);
            }}
          />
        </div>

        {/* Un solo campo para las dos cosas: encontrar una conversación que ya
            existe, o a la persona con la que todavía no hablé. */}
        <div className="border-b border-[#4FAEB2]/12 px-3 py-2">
          <div className="flex items-center gap-1.5 rounded-xl bg-[#4FAEB2]/8 px-2.5 py-1.5 ring-1 ring-transparent focus-within:bg-white focus-within:ring-[#4FAEB2]/40">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              value={filtroBandeja}
              onChange={(e) => setFiltroBandeja(e.target.value)}
              placeholder="Buscar persona o conversación"
              className="min-w-0 flex-1 bg-transparent text-[12px] focus:outline-none"
            />
            {filtroBandeja ? (
              <button type="button" onClick={() => setFiltroBandeja("")} aria-label="Limpiar">
                <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {cargandoSalas ? (
            <p className="px-3.5 py-3 text-[12px] text-slate-400">Cargando…</p>
          ) : salas.length === 0 && !filtroBandeja ? (
            <p className="px-3.5 py-3 text-[12px] leading-relaxed text-slate-400">
              Todavía no tenés conversaciones. Buscá a alguien acá arriba para empezar a hablarle.
            </p>
          ) : (
            salasFiltradas.map((s) => {
              const activa = s.id === salaId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSalaId(s.id)}
                  className={`flex w-full items-center gap-3 border-b border-[#4FAEB2]/10 px-3.5 py-3 text-left transition-colors ${
                    activa
                      ? "bg-gradient-to-r from-[#4FAEB2] to-[#3E9B9F] text-white"
                      : "hover:bg-[#4FAEB2]/8"
                  }`}
                >
                  <Avatar
                    nombre={s.nombre}
                    url={s.avatar_url}
                    size={46}
                    icono={s.tipo === "grupo" ? <Users className="h-5 w-5" /> : undefined}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`min-w-0 truncate text-[14px] font-semibold ${
                          activa ? "text-white" : "text-slate-800"
                        }`}
                      >
                        {nombreCapitular(s.nombre)}
                      </span>
                      <span
                        className={`shrink-0 text-[11px] ${
                          activa ? "text-white/80" : "text-slate-400"
                        }`}
                      >
                        {s.ultimo_mensaje_at ? fechaCorta(s.ultimo_mensaje_at) : ""}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-start justify-between gap-2">
                      {/* Con mensajes se previsualiza el último; sin mensajes,
                          el cargo — un renglón vacío se ve roto. */}
                      <span
                        className={`min-w-0 line-clamp-2 text-[12.5px] leading-tight ${
                          activa ? "text-white/90" : "text-slate-500"
                        }`}
                      >
                        {s.vista_previa
                          ? `${
                              s.tipo === "grupo" && s.vista_previa_autor
                                ? `${nombreCorto(s.vista_previa_autor)}: `
                                : ""
                            }${s.vista_previa}`
                          : s.subtitulo}
                      </span>
                      {s.no_leidos > 0 ? (
                        <span
                          className={`flex h-[19px] min-w-[24px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold ${
                            activa ? "bg-white/25 text-white" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {s.no_leidos > 99 ? "99+" : s.no_leidos}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })
          )}

          {/* Personas con las que todavía no hay conversación abierta. */}
          {filtroBandeja.trim() && personasSugeridas.length > 0 ? (
            <>
              <p className="bg-slate-50 px-3.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                Personas
              </p>
              {personasSugeridas.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void abrirDirecto(u)}
                  disabled={abriendoDirecto === u.id}
                  className="flex w-full items-center gap-3 border-b border-[#4FAEB2]/10 px-3.5 py-3 text-left transition-colors hover:bg-[#4FAEB2]/8 disabled:opacity-50"
                >
                  <Avatar nombre={u.nombre} url={u.avatar_url} size={46} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-slate-800">
                      {nombreCapitular(u.nombre)}
                    </span>
                    <span className="block truncate text-[12.5px] text-slate-500">
                      {u.area || "Usuario"}
                    </span>
                  </span>
                  {abriendoDirecto === u.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
                  ) : null}
                </button>
              ))}
            </>
          ) : null}

          {filtroBandeja.trim() && salasFiltradas.length === 0 && personasSugeridas.length === 0 ? (
            <p className="px-3.5 py-3 text-[12px] leading-relaxed text-slate-400">
              Nadie ni ninguna conversación coincide con “{filtroBandeja}”.
            </p>
          ) : null}
        </div>
      </aside>

      {/* --- Conversación ------------------------------------------------------ */}
      <section
        className={`${verConversacion ? "flex" : "hidden"} min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#4FAEB2]/20 bg-white shadow-[0_2px_12px_rgba(47,110,113,0.08)]`}
      >
        {!salaActual ? (
          <div
            className="flex flex-1 flex-col items-center justify-center px-8 text-center"
            style={ESTILO_FONDO}
          >
            <MessagesSquare className="h-16 w-16 text-[#4FAEB2]/35" strokeWidth={1.2} />
            <p className="mt-3 text-[15px] text-slate-500">
              {cargandoSalas
                ? "Cargando…"
                : salas.length === 0
                  ? "Buscá a alguien arriba para empezar a hablarle."
                  : "Elegí una conversación."}
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-transparent px-3 py-2.5 sm:px-4">
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
              <span className={mobile ? "hidden" : "block"}>
                <Avatar
                  nombre={salaActual.nombre}
                  url={salaActual.avatar_url}
                  size={44}
                  icono={salaActual.tipo === "grupo" ? <Users className="h-5 w-5" /> : undefined}
                />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="flex items-baseline gap-2 truncate">
                  <span className="truncate text-[16px] font-semibold text-slate-800">
                    {nombreCapitular(salaActual.nombre)}
                  </span>
                  {salaActual.tipo !== "grupo" ? (
                    <span className="shrink-0 text-[12.5px] italic text-slate-400">En línea</span>
                  ) : null}
                </h2>
                {/* Quién escribe reemplaza al subtítulo mientras dura: es lo
                    que está pasando ahora, y el cargo no se va a ningún lado. */}
                {quienesEscriben ? (
                  <p className="truncate text-[12.5px] font-medium text-[#2F6E71]">
                    {quienesEscriben}
                  </p>
                ) : (
                  <p className="truncate text-[12.5px] text-slate-400">
                    {salaActual.tipo !== "grupo"
                      ? salaActual.subtitulo
                      : salaActual.descripcion || `${salaActual.miembros} miembros`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {verBuscador ? (
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-2.5 py-1.5 ring-1 ring-transparent focus-within:ring-[#4FAEB2]/40">
                    <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <input
                      ref={buscaRef}
                      value={busca}
                      // Busca mientras se escribe, con una pausa de 250 ms:
                      // tener que apretar Enter para ver si hay algo convierte
                      // cada intento en un viaje de ida y vuelta.
                      onChange={(e) => {
                        const v = e.target.value;
                        setBusca(v);
                        if (buscaTimer.current) clearTimeout(buscaTimer.current);
                        buscaTimer.current = setTimeout(() => {
                          if (v.trim()) {
                            setEnBusqueda(true);
                            void cargarMensajes(salaActual.id, v, true);
                          } else if (enBusqueda) {
                            setEnBusqueda(false);
                            void cargarMensajes(salaActual.id, undefined, true);
                          }
                        }, 250);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && busca.trim()) {
                          setEnBusqueda(true);
                          void cargarMensajes(salaActual.id, busca, true);
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
                // Globos de mentira mientras llega lo de verdad: dice "acá va
                // una conversación, esperá" sin dejar la pantalla en blanco ni
                // mostrar la anterior.
                <div className="space-y-3 py-2">
                  {[
                    { propio: false, ancho: "w-48" },
                    { propio: false, ancho: "w-64" },
                    { propio: true, ancho: "w-40" },
                    { propio: false, ancho: "w-56" },
                    { propio: true, ancho: "w-52" },
                  ].map((f, i) => (
                    <div
                      key={i}
                      className={`flex items-end gap-2 ${f.propio ? "justify-end" : ""}`}
                    >
                      {!f.propio ? (
                        <span className="h-[34px] w-[34px] shrink-0 animate-pulse rounded-full bg-white/70" />
                      ) : null}
                      <span
                        className={`h-9 animate-pulse rounded-xl ${f.ancho} ${
                          f.propio ? "bg-[#D8EBDA]" : "bg-white/80"
                        }`}
                      />
                    </div>
                  ))}
                </div>
              ) : mensajes.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                  <MessagesSquare className="h-16 w-16 text-[#4FAEB2]/35" strokeWidth={1.2} />
                  <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-slate-500">
                    {enBusqueda
                      ? "Ningún mensaje coincide con la búsqueda."
                      : "Escribí algo, mandá un archivo o grabá un audio."}
                  </p>
                </div>
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
                          <span className="rounded-full bg-white px-3.5 py-1 text-[12px] font-medium text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.08)]">
                            {diaLabel(m.created_at)}
                          </span>
                        </div>
                      ) : null}
                      <div
                        className={`group relative flex gap-2 ${
                          m.propio ? "justify-end" : "justify-start"
                        }`}
                      >
                        {/* La cara va por fuera del globo y sólo en el último de
                            una tanda: repetirla en cada renglón parte la lectura
                            de una misma intervención. En lo propio no va: ya se
                            sabe de quién es, y ocupa lugar. */}
                        {!m.propio ? (
                          <span className={`self-end ${seguido ? "invisible" : ""}`}>
                            <Avatar nombre={m.autor} url={m.autor_avatar} size={34} />
                          </span>
                        ) : null}
                        <div
                          style={m.propio ? { background: BURBUJA_PROPIA } : undefined}
                          className={`relative max-w-[78%] rounded-xl px-3.5 py-2 text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.12)] ${
                            Object.keys(m.reacciones).length > 0 ? "mb-4" : ""
                          } ${m.propio ? "" : "bg-white"}`}
                        >

                          {/* El nombre va DENTRO del globo: afuera, sobre el
                              fondo, los colores claros de la paleta no llegan a
                              contrastar y el renglón se pierde. */}
                          {!seguido && !m.propio && salaActual.tipo === "grupo" ? (
                            <div className="mb-0.5 text-[13px] font-semibold" style={{ color: c }}>
                              {nombreCapitular(m.autor)}
                            </div>
                          ) : null}
                          {m.cita ? (
                            <div className="mb-1.5 border-l-[3px] border-[#4FAEB2] pl-2.5 text-[13px]">
                              <span className="block font-semibold text-[#2F6E71]">
                                {nombreCapitular(m.cita.autor)}
                              </span>
                              <span className="line-clamp-2 text-slate-500">
                                {m.cita.texto ?? "Mensaje eliminado"}
                              </span>
                            </div>
                          ) : null}
                          {m.eliminado ? (
                            <p className="text-[14px] italic opacity-60">Mensaje eliminado</p>
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
                                <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">
                                  <span className="float-right ml-2 mt-[9px] text-[11px] leading-none text-slate-400">
                                    {m.pendiente
                                      ? "enviando…"
                                      : `${m.editado_at ? "editado · " : ""}${hora(m.created_at)}`}
                                    {" "}
                                    {m.propio && !m.pendiente ? (
                                      <Visto
                                        leidoPor={m.leido_por}
                                        destinatarios={m.destinatarios}
                                        nombres={m.leido_por_nombres}
                                      />
                                    ) : null}
                                  </span>
                                  {m.texto}
                                </p>
                              ) : null}
                              {m.adjuntos.map((a) => (
                                <div key={a.path} className="mt-1.5">
                                  <Adjuntito
                                    a={a}
                                    onVer={() => abrirVisor(a)}
                                    onDescargar={() => void descargar(a)}
                                  />
                                </div>
                              ))}
                            </>
                          )}
                          {!m.texto || m.eliminado || editando?.id === m.id ? (
                            <div className="mt-0.5 text-right text-[11px] text-slate-400">
                              {m.pendiente ? "enviando… " : m.editado_at ? "editado · " : ""}
                              {m.pendiente ? "" : hora(m.created_at)}
                              {" "}
                                    {m.propio && !m.pendiente ? (
                                      <Visto
                                        leidoPor={m.leido_por}
                                        destinatarios={m.destinatarios}
                                        nombres={m.leido_por_nombres}
                                      />
                                    ) : null}
                            </div>
                          ) : null}

                          {/* Las reacciones cuelgan del borde del globo, no lo
                              ensanchan: son un comentario sobre el mensaje, no
                              parte de él. */}
                          {Object.keys(m.reacciones).length > 0 ? (
                            <div
                              className={`absolute -bottom-3.5 z-10 flex flex-wrap gap-1 ${
                                m.propio ? "right-2" : "left-2.5"
                              }`}
                            >
                              {Object.entries(m.reacciones).map(([emoji, quienes]) => {
                                const nombres = (m.reacciones_nombres?.[emoji] ?? []).map((n) =>
                                  nombreCorto(n)
                                );
                                const caras = m.reacciones_avatares?.[emoji] ?? [];
                                return (
                                  <span key={emoji} className="group/reac relative">
                                    <button
                                      type="button"
                                      onClick={() => void reaccionar(m.id, emoji)}
                                      // `title` como respaldo: si el hover del
                                      // globito no llega, el navegador lo dice igual.
                                      title={nombres.join(", ")}
                                      className="flex items-center gap-1 rounded-full bg-[#DDEFF0] px-1.5 py-[3px] leading-none shadow-[0_1px_2px_rgba(15,23,42,0.15)] transition-colors hover:bg-[#CBE6E8]"
                                    >
                                      <span className="text-[13px]">{emoji}</span>
                                      {/* Las caras de quienes reaccionaron, en
                                          vez de un número: se ve quién sin abrir
                                          nada. Más de tres serían ilegibles. */}
                                      <span className="flex -space-x-1.5">
                                        {nombres.slice(0, 3).map((n, i) => (
                                          <span
                                            key={`${n}-${i}`}
                                            className="rounded-full ring-[1.5px] ring-white"
                                          >
                                            <Avatar nombre={n} url={caras[i]} size={17} />
                                          </span>
                                        ))}
                                      </span>
                                      {quienes.length > 3 ? (
                                        <span className="text-[10px] font-semibold text-slate-500">
                                          +{quienes.length - 3}
                                        </span>
                                      ) : null}
                                    </button>
                                    {nombres.length > 0 ? (
                                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover/reac:block">
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
                            competir con el texto en reposo.

                            En los mensajes propios van ANTES del globo: aunque
                            estén invisibles ocupan su ancho, y puestas después
                            empujaban el globo hacia adentro — nunca llegaba al
                            borde derecho. */}
                        {!m.eliminado && !enBusqueda && !m.pendiente ? (
                          <div
                            className={`flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100 ${
                              m.propio ? "order-first" : ""
                            }`}
                          >
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
            <div className="border-t border-[#4FAEB2]/15 bg-white px-3 py-3 sm:px-4">
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
              {/* Una tarjeta grande con el clip a la izquierda y las acciones
                  abajo a la derecha: se lee como una hoja donde escribir, no
                  como una barra de controles. */}
              <div className="rounded-2xl border border-[#4FAEB2]/25 bg-white px-3 py-2.5 shadow-[0_1px_5px_rgba(47,110,113,0.10)] transition-colors focus-within:border-[#4FAEB2] focus-within:shadow-[0_2px_10px_rgba(79,174,178,0.18)]">
                <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={subiendo}
                  title="Adjuntar archivo"
                  className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-[#2F6E71] disabled:opacity-40"
                >
                  {subiendo ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Paperclip className="h-[18px] w-[18px]" />}
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
                    if (e.target.value) {
                      const antes = ultimoAvisoRef.current;
                      avisarQueEscribo();
                      // `avisarQueEscribo` ya trae el freno de los dos
                      // segundos; si avanzó, es que tocaba avisar.
                      if (ultimoAvisoRef.current !== antes) avisarQueEscriboPorApi();
                    }
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
                  placeholder="Escribí @ para mencionar a alguien"
                  className="max-h-40 min-h-[26px] w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
                </div>
                </div>

                <div className="mt-1 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={alternarGrabacion}
                    title={grabando ? "Detener y enviar audio" : "Grabar audio"}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                      grabando
                        ? "animate-pulse bg-rose-50 text-rose-600"
                        : "text-slate-400 hover:bg-slate-100 hover:text-[#2F6E71]"
                    }`}
                  >
                    {grabando ? <Square className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void enviar()}
                    disabled={enviando || (!texto.trim() && adjuntos.length === 0)}
                    title="Enviar"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-[#4FAEB2] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <Send className="h-[18px] w-[18px]" />
                  </button>
                </div>
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
          className={`flex flex-col overflow-hidden rounded-2xl border border-[#4FAEB2]/20 bg-[#F4F8F8] shadow-[0_2px_12px_rgba(47,110,113,0.08)] ${
            mobile ? "absolute inset-0 z-20" : "ml-3 w-80 shrink-0"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-white px-3 py-3">
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
            {/* Identidad. En un grupo, un administrador la edita acá mismo:
                el nombre, la descripción y la foto son del grupo y cambian
                cuando el grupo cambia. */}
            <div className="rounded-2xl bg-white p-4 text-center shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
              <div className="relative mx-auto w-20">
                <Avatar
                  nombre={salaActual.nombre}
                  url={salaActual.avatar_url}
                  size={80}
                  icono={salaActual.tipo === "grupo" ? <Users className="h-8 w-8" /> : undefined}
                />
                {puedoEditarGrupo ? (
                  <button
                    type="button"
                    onClick={() => fotoGrupoRef.current?.click()}
                    disabled={subiendoFotoGrupo}
                    title="Cambiar la foto del grupo"
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50 opacity-0 transition-opacity hover:opacity-100"
                  >
                    {subiendoFotoGrupo ? (
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    ) : (
                      <Camera className="h-5 w-5 text-white" />
                    )}
                  </button>
                ) : null}
              </div>
              {puedoEditarGrupo ? (
                <input
                  ref={fotoGrupoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void cambiarFotoGrupo(f);
                  }}
                />
              ) : null}

              {editandoGrupo ? (
                <div className="mt-3 space-y-2 text-left">
                  <label className="block">
                    <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                      Nombre
                    </span>
                    <input
                      autoFocus
                      value={editandoGrupo.nombre}
                      maxLength={80}
                      onChange={(e) =>
                        setEditandoGrupo((g) => (g ? { ...g, nombre: e.target.value } : g))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void guardarGrupo();
                        if (e.key === "Escape") setEditandoGrupo(null);
                      }}
                      className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-[13px] text-slate-800 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                      Descripción
                    </span>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={editandoGrupo.descripcion}
                      onChange={(e) =>
                        setEditandoGrupo((g) => (g ? { ...g, descripcion: e.target.value } : g))
                      }
                      placeholder="Para qué es este grupo"
                      className="w-full resize-none rounded-xl border border-slate-200 px-2.5 py-1.5 text-[12.5px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none"
                    />
                  </label>
                  <div className="flex items-center justify-end gap-2 pt-0.5">
                    {salaActual.avatar_url ? (
                      <button
                        type="button"
                        onClick={() => void quitarFotoGrupo()}
                        className="mr-auto text-[11px] text-slate-400 hover:text-rose-600"
                      >
                        Quitar foto
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setEditandoGrupo(null)}
                      className="rounded-lg px-2.5 py-1 text-[12px] text-slate-500 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void guardarGrupo()}
                      disabled={guardandoGrupo}
                      className="flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {guardandoGrupo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Guardar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-2.5 text-[15px] font-semibold text-slate-800">
                    {nombreCapitular(salaActual.nombre)}
                  </p>
                  <p className="text-[12px] text-slate-400">
                    {salaActual.tipo === "grupo"
                      ? `Grupo · ${salaActual.miembros} integrantes`
                      : "Conversación directa"}
                  </p>
                  {salaActual.descripcion ? (
                    <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-600">
                      {salaActual.descripcion}
                    </p>
                  ) : null}
                  {salaActual.tipo === "grupo" ? (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
                      {salaActual.miembros_nombres.map((n) => nombreCapitular(n)).join(" · ")}
                    </p>
                  ) : null}
                  {puedoEditarGrupo ? (
                    <button
                      type="button"
                      onClick={() =>
                        setEditandoGrupo({
                          nombre: salaActual.nombre,
                          descripcion: salaActual.descripcion ?? "",
                        })
                      }
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2]/12 px-3 py-1.5 text-[12px] font-semibold text-[#2F6E71] transition-colors hover:bg-[#4FAEB2]/20"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar grupo
                    </button>
                  ) : salaActual.tipo === "grupo" ? (
                    <p className="mt-3 text-[11px] text-slate-400">
                      Sólo un administrador del grupo puede editarlo.
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {/* Integrantes */}
            {salaActual.tipo === "grupo" ? (
              <div className="rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-slate-800">
                    Integrantes · {miembrosSala.length}
                  </p>
                  {puedoEditarGrupo ? (
                    <button
                      type="button"
                      onClick={() => setSumando(sumando === null ? "" : null)}
                      className="flex items-center gap-1 rounded-lg bg-[#4FAEB2]/12 px-2 py-1 text-[11.5px] font-semibold text-[#2F6E71] transition-colors hover:bg-[#4FAEB2]/20"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Agregar
                    </button>
                  ) : null}
                </div>

                {sumando !== null ? (
                  <div className="mb-2 rounded-xl border border-slate-200 p-2">
                    <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1">
                      <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <input
                        autoFocus
                        value={sumando}
                        onChange={(e) => setSumando(e.target.value)}
                        placeholder="Buscar a alguien"
                        className="min-w-0 flex-1 bg-transparent text-[12px] focus:outline-none"
                      />
                    </div>
                    <ul className="max-h-44 overflow-y-auto">
                      {candidatosASumar.length === 0 ? (
                        <li className="px-1 py-1.5 text-[11.5px] text-slate-400">
                          {sumando.trim()
                            ? "Nadie coincide, o ya está en el grupo."
                            : "Escribí un nombre."}
                        </li>
                      ) : (
                        candidatosASumar.map((u) => (
                          <li key={u.id}>
                            <button
                              type="button"
                              disabled={tocandoMiembros}
                              onClick={() => void tocarMiembros({ agregar: [u.id] })}
                              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-slate-50 disabled:opacity-50"
                            >
                              <Avatar nombre={u.nombre} url={u.avatar_url} size={26} />
                              <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">
                                {nombreCapitular(u.nombre)}
                              </span>
                              <UserPlus className="h-3.5 w-3.5 shrink-0 text-[#4FAEB2]" />
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ) : null}

                <ul className="space-y-0.5">
                  {miembrosSala.map((m) => (
                    <li
                      key={m.usuario_id}
                      className="group/mi flex items-center gap-2 rounded-lg px-1 py-1.5"
                    >
                      {/* La corona va sobre el avatar: así se ve quién manda
                          mirando las caras, sin leer una línea por persona. */}
                      <span className="relative shrink-0">
                        <Avatar nombre={m.nombre} url={m.avatar_url} size={30} />
                        {m.rol === "admin" ? (
                          <Crown
                            className="absolute -right-1 -top-1.5 h-3.5 w-3.5 -rotate-12 fill-[#F5B301] text-[#B57F00]"
                            strokeWidth={1.5}
                          />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 truncate text-[12.5px] font-medium text-slate-700">
                          {nombreCapitular(m.nombre)}
                          {m.propio ? " (vos)" : ""}
                        </span>
                        {m.rol === "admin" ? (
                          <span className="flex items-center gap-1 text-[10.5px] font-semibold text-[#B57F00]">
                            <Crown className="h-3 w-3 fill-[#F5B301] text-[#B57F00]" strokeWidth={1.5} />
                            Administrador
                          </span>
                        ) : null}
                      </span>
                      {/* Nombrar y sacar es de un admin; salir es de
                          cualquiera. Puede degradarse a sí mismo, que es el
                          paso previo a irse dejando el grupo administrado. */}
                      {puedoEditarGrupo ? (
                        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/mi:opacity-100">
                          <button
                            type="button"
                            disabled={tocandoMiembros}
                            onClick={() =>
                              void tocarMiembros(
                                m.rol === "admin"
                                  ? { degradar: [m.usuario_id] }
                                  : { promover: [m.usuario_id] }
                              )
                            }
                            title={
                              m.rol === "admin"
                                ? `Quitarle a ${nombreCorto(m.nombre)} el rol de administrador`
                                : `Hacer administrador a ${nombreCorto(m.nombre)}`
                            }
                            className={`rounded-lg p-1 transition-colors disabled:opacity-40 ${
                              m.rol === "admin"
                                ? "text-[#B57F00] hover:text-slate-400"
                                : "text-slate-300 hover:text-[#B57F00]"
                            }`}
                          >
                            <Crown
                              className={`h-4 w-4 ${m.rol === "admin" ? "fill-[#F5B301]" : ""}`}
                              strokeWidth={1.5}
                            />
                          </button>
                          {!m.propio ? (
                            <button
                              type="button"
                              disabled={tocandoMiembros}
                              onClick={() => void tocarMiembros({ quitar: [m.usuario_id] })}
                              title={`Sacar a ${nombreCorto(m.nombre)} del grupo`}
                              className="rounded-lg p-1 text-slate-300 transition-colors hover:text-rose-600 disabled:opacity-40"
                            >
                              <UserMinus className="h-4 w-4" />
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  disabled={tocandoMiembros}
                  onClick={() => {
                    if (!perfil) return;
                    void tocarMiembros({ quitar: [perfil.usuario_id] });
                  }}
                  className="mt-2 w-full rounded-lg border border-slate-200 py-1.5 text-[12px] font-semibold text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  Salir del grupo
                </button>
              </div>
            ) : null}

            {/* Resumen de lo compartido */}
            <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
              {(
                [
                  { icono: <FileText className="h-4 w-4" />, txt: "Documentos", n: biblioteca?.archivos.length },
                  { icono: <ImageIcon className="h-4 w-4" />, txt: "Fotos y videos", n: biblioteca?.imagenes.length },
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

      {/* --- Visor de imágenes -------------------------------------------------
          A pantalla completa y sobre fondo oscuro: una imagen compartida casi
          siempre es una captura que hay que leer, y en la miniatura del globo
          no se lee. */}
      {viendo?.url ? (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-slate-900/92 backdrop-blur-sm"
          onClick={() => setViendoIdx(null)}
        >
          <div
            className="flex items-center gap-3 px-4 py-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{viendo.nombre}</span>
              <span className="block text-[11px] text-white/60">
                {pesoLegible(viendo.size_bytes)}
                {galeria.length > 1 ? ` · ${(viendoIdx ?? 0) + 1} de ${galeria.length}` : ""}
              </span>
            </span>
            <a
              href={viendo.url}
              target="_blank"
              rel="noreferrer"
              title="Abrir en otra pestaña"
              className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ExternalLink className="h-5 w-5" />
            </a>
            <button
              type="button"
              onClick={() => void descargar(viendo)}
              title="Descargar"
              className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Download className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setViendoIdx(null)}
              aria-label="Cerrar"
              className="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
            {galeria.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    mover(-1);
                  }}
                  aria-label="Anterior"
                  className="absolute left-3 z-10 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    mover(1);
                  }}
                  aria-label="Siguiente"
                  className="absolute right-3 z-10 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            ) : null}

            {tipoDe(viendo) === "video" ? (
              <video
                key={viendo.path}
                src={viendo.url}
                controls
                autoPlay
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full rounded-lg shadow-2xl"
              />
            ) : tipoDe(viendo) === "pdf" ? (
              // El PDF se lee acá adentro. Si el navegador no lo muestra, los
              // botones de arriba siguen estando.
              <iframe
                key={viendo.path}
                src={viendo.url}
                title={viendo.nombre}
                onClick={(e) => e.stopPropagation()}
                className="h-full w-full max-w-5xl rounded-lg bg-white shadow-2xl"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={viendo.path}
                src={viendo.url}
                alt={viendo.nombre}
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              />
            )}
          </div>
        </div>
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
              {nombreGrupo.trim() ? (
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Descripción
                  </span>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={descGrupo}
                    onChange={(e) => setDescGrupo(e.target.value)}
                    placeholder="Para qué es este grupo (se puede cambiar después)"
                    className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] leading-relaxed focus:border-[#4FAEB2] focus:outline-none"
                  />
                </label>
              ) : null}
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
                          <Avatar nombre={u.nombre} url={u.avatar_url} size={26} />
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
