"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  QA_ESTADOS,
  QA_ORIGENES,
  QA_SEVERIDADES,
  qaCodigoObservacion,
  type QAObservacionEstado,
  type QAObservacionOrigen,
  type QAObservacionSeveridad,
} from "@/lib/proyectos/qa-observaciones-config";
import QAImageDropzone from "./QAImageDropzone";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import type {
  QAApiResp,
  QAArchivo,
  QAComentario,
  QAComentarioOrigen,
  QAObservacion,
  QASeccion,
  QAUsuario,
} from "./types";
import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  FiltroSelect,
  INPUT_CLS,
  IconImage,
  IconTrash,
  fechaRelativa,
  iniciales,
} from "./ui";

type Props = {
  projectId: string;
  obs: QAObservacion;
  secciones: QASeccion[];
  usuarios: QAUsuario[];
  onClose: () => void;
  onActualizada: (obs: QAObservacion) => void;
  onEliminada: (id: string) => void;
  onSeccionCreada: (seccion: QASeccion) => void;
  /** Refresca el contador de comentarios de la card sin recargar todo. */
  onComentariosCambio: (obsId: string, total: number) => void;
  /**
   * Vista que le corresponde a quien mira. La resuelve el servidor
   * (`qa-permisos.ts`), no el cliente.
   *  - "qa": QA, Project Manager y admin. Ve el Seguimiento interno.
   *  - "desarrollo": el técnico del proyecto. Misma incidencia y misma
   *    conversación técnica, sin el hilo interno.
   */
  vista: "qa" | "desarrollo";
  /**
   * Si puede leer/escribir el Seguimiento interno. Va aparte de `vista` porque
   * es el servidor quien lo decide: la UI sólo lo obedece. Aunque acá se
   * forzara en true, la API no devuelve esos comentarios ni acepta escribirlos.
   */
  puedeVerInterno: boolean;
};

const LABEL_CLS = "text-[11px] font-medium uppercase tracking-wide text-slate-500";

/**
 * Bloque blanco con título, que es la unidad visual del rediseño: cada parte de
 * la incidencia (Descripción, Capturas, Conversación, Información) vive en una
 * tarjeta sobre el fondo gris, en vez de ser una lista continua de campos.
 */
function Tarjeta({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
        <span aria-hidden="true" className="h-3.5 w-1 rounded-full bg-[#7DCFD2]" />
        {titulo}
      </h3>
      {subtitulo ? (
        <p className="mb-2 mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
          <IconPersonas />
          {subtitulo}
        </p>
      ) : (
        <div className="mb-2" />
      )}
      {children}
    </section>
  );
}

/** Dos siluetas: acompaña al "Visible para QA y Desarrollo". */
function IconPersonas() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" strokeLinecap="round" />
    </svg>
  );
}

/** Candado del chip "Privado": el ícono refuerza el mensaje sin depender del color. */
function IconCandado() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" strokeLinecap="round" />
    </svg>
  );
}

export default function ObservacionModal({
  projectId,
  obs,
  secciones,
  usuarios,
  onClose,
  onActualizada,
  onEliminada,
  onSeccionCreada,
  onComentariosCambio,
  vista,
  puedeVerInterno,
}: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [titulo, setTitulo] = useState(obs.titulo);
  const [descripcion, setDescripcion] = useState(obs.descripcion ?? "");
  const [urlRef, setUrlRef] = useState(obs.url_referencia ?? "");

  const [comentarios, setComentarios] = useState<QAComentario[]>([]);
  const [comentariosCargando, setComentariosCargando] = useState(true);
  /** Borrador de la conversación técnica: uno solo, lo escriba QA o Desarrollo. */
  const [nuevoComentarioTecnico, setNuevoComentarioTecnico] = useState("");
  const [nuevoComentarioInterno, setNuevoComentarioInterno] = useState("");
  /** Evita disparar dos cambios de estado encima mientras el primero viaja. */
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  /** Quién está mirando, para ofrecer editar/eliminar sólo en lo propio. */
  const [usuarioId, setUsuarioId] = useState<string | null>(null);

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [subiendo, setSubiendo] = useState(0);
  const enviandoRef = useRef(false);

  // El carril lo decide `origen` (en qué caja se escribió), no el autor: los
  // comentarios de antes de esta funcionalidad no tienen `origen` propio y
  // quedaron migrados a "qa" — ver la nota en la migración.
  const comentariosInternos = useMemo(
    () => comentarios.filter((c) => c.origen === "interno"),
    [comentarios]
  );
  /**
   * Conversación técnica: QA y Desarrollo en un solo hilo, ordenados por fecha.
   * Se lee como una conversación y no como dos monólogos en paralelo. El hilo
   * interno queda fuera a propósito: tiene su propio panel.
   */
  const comentariosTecnicos = useMemo(
    () =>
      comentarios
        .filter((c) => c.origen === "qa" || c.origen === "tecnico")
        .slice()
        .sort((x, y) => x.created_at.localeCompare(y.created_at)),
    [comentarios]
  );

  const imagenes = useMemo(
    () => obs.archivos.filter((a) => (a.mime_type ?? "").startsWith("image/")),
    [obs.archivos]
  );
  const adjuntosNoImagen = useMemo(
    () => obs.archivos.filter((a) => !(a.mime_type ?? "").startsWith("image/")),
    [obs.archivos]
  );

  // Si la observación cambia por realtime, los borradores se re-sincronizan.
  const obsId = obs.id;
  useEffect(() => {
    setTitulo(obs.titulo);
    setDescripcion(obs.descripcion ?? "");
    setUrlRef(obs.url_referencia ?? "");
    // Solo al cambiar de observación: mientras se edita, el estado local manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obsId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (lightboxIdx !== null) setLightboxIdx(null);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, onClose]);

  const cargarComentarios = useCallback(async () => {
    const res = await fetchWithSupabaseSession(
      `/api/proyectos/${projectId}/qa/observaciones/${obsId}/comentarios`,
      { cache: "no-store" }
    );
    const j = (await res.json().catch(() => null)) as QAApiResp<{
      comentarios: QAComentario[];
      usuario_id?: string | null;
    }> | null;
    if (res.ok && j?.success && j.data) {
      setComentarios(j.data.comentarios);
      setUsuarioId(j.data.usuario_id ?? null);
      onComentariosCambio(obsId, j.data.comentarios.length);
    }
    setComentariosCargando(false);
  }, [projectId, obsId, onComentariosCambio]);

  useEffect(() => {
    setComentariosCargando(true);
    void cargarComentarios();
  }, [cargarComentarios]);

  // --- Mutaciones -----------------------------------------------------------

  async function guardar(patch: Record<string, unknown>) {
    const res = await fetchWithSupabaseSession(
      `/api/proyectos/${projectId}/qa/observaciones/${obsId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    const j = (await res.json().catch(() => null)) as QAApiResp<QAObservacion> | null;
    if (!res.ok || !j?.success || !j.data) {
      setErr(j?.error ?? "No se pudo guardar");
      return;
    }
    setErr(null);
    onActualizada(j.data);
  }

  /**
   * Cambia el estado de forma OPTIMISTA: el chip se mueve en el acto y recién
   * después se confirma contra el servidor. Si falla, vuelve al estado anterior
   * y se muestra el error.
   *
   * Antes se esperaba la respuesta completa para recién ahí pintar el cambio, y
   * como el endpoint encadena varios viajes a la base, el usuario veía el botón
   * "colgado" varios segundos. El trabajo del servidor es el mismo; lo que
   * cambia es que ya no se le hace esperar por algo que casi siempre sale bien.
   */
  async function cambiarEstado(estado: QAObservacionEstado) {
    if (estado === obs.estado || cambiandoEstado) return;
    const anterior = obs;
    setCambiandoEstado(true);
    setErr(null);
    onActualizada({ ...obs, estado });
    try {
      const res = await fetchWithSupabaseSession(
        `/api/proyectos/${projectId}/qa/observaciones/${obsId}/estado`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado }),
        }
      );
      const j = (await res.json().catch(() => null)) as QAApiResp<QAObservacion> | null;
      if (!res.ok || !j?.success || !j.data) {
        onActualizada(anterior);
        setErr(j?.error ?? "No se pudo cambiar el estado");
        return;
      }
      // La respuesta trae los sellos (quién resolvió/verificó y cuándo), que el
      // optimista no podía saber.
      onActualizada(j.data);
    } catch {
      onActualizada(anterior);
      setErr("No se pudo cambiar el estado. Revisá la conexión.");
    } finally {
      setCambiandoEstado(false);
    }
  }

  /** Crea la sección y la deja aplicada a esta observación en un solo gesto. */
  async function crearYAsignarSeccion(nombre: string) {
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/qa/secciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre }),
    });
    const j = (await res.json().catch(() => null)) as QAApiResp<QASeccion> | null;
    if (!res.ok || !j?.success || !j.data) {
      setErr(j?.error ?? "No se pudo crear la sección");
      return;
    }
    setErr(null);
    onSeccionCreada(j.data);
    await guardar({ seccion_id: j.data.id });
  }

  async function eliminarObservacion() {
    if (!window.confirm(`¿Eliminar ${qaCodigoObservacion(obs.numero)} y sus adjuntos?`)) return;
    const res = await fetchWithSupabaseSession(
      `/api/proyectos/${projectId}/qa/observaciones/${obsId}`,
      { method: "DELETE" }
    );
    const j = (await res.json().catch(() => null)) as QAApiResp<unknown> | null;
    if (!res.ok || !j?.success) {
      setErr(j?.error ?? "No se pudo eliminar");
      return;
    }
    onEliminada(obsId);
  }

  /**
   * `origen` decide el carril donde aparece el mensaje — "Nota de QA" o
   * "Respuesta del técnico" —, no quién lo escribe: cualquiera con acceso al
   * proyecto puede publicar en cualquiera de los dos, igual que antes cuando
   * era un solo hilo.
   */
  async function publicarComentario(origen: QAComentarioOrigen) {
    // La conversación técnica tiene UNA sola caja —la escriban QA o
    // Desarrollo—, así que `qa` y `tecnico` comparten borrador. El origen sale
    // del rol de quien escribe, no de en qué caja tipeó.
    const texto = (origen === "interno" ? nuevoComentarioInterno : nuevoComentarioTecnico).trim();
    if (!texto || enviandoRef.current) return;
    enviandoRef.current = true;
    try {
      const res = await fetchWithSupabaseSession(
        `/api/proyectos/${projectId}/qa/observaciones/${obsId}/comentarios`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto, origen }),
        }
      );
      const j = (await res.json().catch(() => null)) as QAApiResp<QAComentario> | null;
      if (!res.ok || !j?.success || !j.data) {
        setErr(j?.error ?? "No se pudo comentar");
        return;
      }
      setErr(null);
      if (origen === "interno") setNuevoComentarioInterno("");
      else setNuevoComentarioTecnico("");
      setComentarios((prev) => {
        const next = [...prev, j.data as QAComentario];
        onComentariosCambio(obsId, next.length);
        return next;
      });
    } finally {
      enviandoRef.current = false;
    }
  }

  async function eliminarComentario(c: QAComentario) {
    if (!window.confirm("¿Eliminar el comentario?")) return;
    const snapshot = comentarios;
    setComentarios((prev) => {
      const next = prev.filter((x) => x.id !== c.id);
      onComentariosCambio(obsId, next.length);
      return next;
    });
    const res = await fetchWithSupabaseSession(
      `/api/proyectos/${projectId}/qa/observaciones/${obsId}/comentarios/${c.id}`,
      { method: "DELETE" }
    );
    const j = (await res.json().catch(() => null)) as QAApiResp<unknown> | null;
    if (!res.ok || !j?.success) {
      setComentarios(snapshot);
      onComentariosCambio(obsId, snapshot.length);
      setErr(j?.error ?? "No se pudo eliminar el comentario");
    }
  }

  /**
   * Edita un comentario propio. Optimista igual que el borrado: el texto nuevo
   * se ve en el acto y vuelve atrás si el servidor lo rechaza (por ejemplo si
   * alguien intenta editar el de otro, que la API corta con 403).
   */
  async function editarComentario(c: QAComentario, texto: string) {
    const limpio = texto.trim();
    if (!limpio || limpio === c.texto) return;
    const snapshot = comentarios;
    setComentarios((prev) => prev.map((x) => (x.id === c.id ? { ...x, texto: limpio } : x)));
    const res = await fetchWithSupabaseSession(
      `/api/proyectos/${projectId}/qa/observaciones/${obsId}/comentarios/${c.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: limpio }),
      }
    );
    const j = (await res.json().catch(() => null)) as QAApiResp<QAComentario> | null;
    if (!res.ok || !j?.success || !j.data) {
      setComentarios(snapshot);
      setErr(j?.error ?? "No se pudo editar el comentario");
      return;
    }
    setComentarios((prev) => prev.map((x) => (x.id === c.id ? j.data! : x)));
  }

  /** El dropzone solo entrega los archivos; acá se suben contra la observación. */
  async function subirArchivos(archivos: File[]) {
    setSubiendo((n) => n + archivos.length);
    try {
      const nuevos: QAArchivo[] = [];
      for (const file of archivos) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetchWithSupabaseSession(
          `/api/proyectos/${projectId}/qa/observaciones/${obsId}/archivos`,
          { method: "POST", body: form }
        );
        const j = (await res.json().catch(() => null)) as QAApiResp<QAArchivo> | null;
        if (!res.ok || !j?.success || !j.data) {
          setErr(j?.error ?? `No se pudo subir "${file.name}"`);
          continue;
        }
        nuevos.push(j.data);
      }
      if (nuevos.length > 0) onActualizada({ ...obs, archivos: [...obs.archivos, ...nuevos] });
    } finally {
      setSubiendo((n) => Math.max(0, n - archivos.length));
    }
  }

  async function eliminarArchivo(a: QAArchivo) {
    if (!window.confirm(`¿Eliminar "${a.nombre}"?`)) return;
    const snapshot = obs.archivos;
    onActualizada({ ...obs, archivos: snapshot.filter((x) => x.id !== a.id) });
    const res = await fetchWithSupabaseSession(
      `/api/proyectos/${projectId}/qa/observaciones/${obsId}/archivos/${a.id}`,
      { method: "DELETE" }
    );
    const j = (await res.json().catch(() => null)) as QAApiResp<unknown> | null;
    if (!res.ok || !j?.success) {
      onActualizada({ ...obs, archivos: snapshot });
      setErr(j?.error ?? "No se pudo eliminar el adjunto");
    }
  }

  // --- Render ---------------------------------------------------------------

  const seccionActual = obs.seccion_id
    ? secciones.find((s) => s.id === obs.seccion_id) ?? null
    : null;
  const estadoActual = QA_ESTADOS.find((e) => e.codigo === obs.estado) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${qaCodigoObservacion(obs.numero)} — ${obs.titulo}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[92vh] sm:max-w-6xl sm:rounded-2xl">
        {/* ---------------------------------------------------------------
            Cabecera: código, título, y los dos chips que dicen de un vistazo
            qué se está mirando (qué vista) y en qué estado está la incidencia.
        ---------------------------------------------------------------- */}
        <SpotlightCard
          spotlightColor="rgba(125, 207, 210, 0.16)"
          className="shrink-0"
        >
        <div className="flex items-start gap-3 bg-[#0B3A3D] px-5 py-3.5">
          <span className="mt-0.5 shrink-0 rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] font-semibold tabular-nums text-[#7DCFD2]">
            {qaCodigoObservacion(obs.numero)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold uppercase tracking-tight text-white">
                {obs.titulo}
              </h2>
              <span
                className="shrink-0 rounded-full border border-[#7DCFD2]/40 bg-[#7DCFD2]/15 px-2 py-0.5 text-[11px] font-semibold text-[#7DCFD2]"
              >
                {vista === "qa" ? "Vista de QA" : "Vista de Desarrollo"}
              </span>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                style={{ backgroundColor: estadoActual?.color ?? "#94a3b8" }}
              >
                {estadoActual?.label ?? obs.estado}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-white/60">
              {seccionActual ? seccionActual.nombre : "Sin sección"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {vista === "qa" ? (
              <button
                type="button"
                onClick={() => void eliminarObservacion()}
                className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-rose-300"
                aria-label="Eliminar observación"
              >
                <IconTrash />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2.5 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              Cerrar
            </button>
          </div>
        </div>
        </SpotlightCard>

        {/* ---------------------------------------------------------------
            Cuerpo en dos columnas: a la izquierda el contenido de la
            incidencia (lo que se lee), a la derecha los campos y el hilo
            interno (lo que se opera). En pantallas angostas se apila.
        ---------------------------------------------------------------- */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-4">
          {err ? <p className="mb-3 text-xs text-rose-600">{err}</p> : null}

          <div className="grid gap-4 lg:grid-cols-3">
            {/* ------------------------- IZQUIERDA ------------------------- */}
            <div className="space-y-4 lg:col-span-2">
              <Tarjeta titulo="Descripción">
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  onBlur={() => {
                    const t = titulo.trim();
                    if (!t) {
                      setTitulo(obs.titulo);
                      return;
                    }
                    if (t !== obs.titulo) void guardar({ titulo: t });
                  }}
                  className={`${INPUT_CLS} font-medium`}
                  placeholder="Qué hay que ajustar"
                />
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  onBlur={() => {
                    if (descripcion !== (obs.descripcion ?? "")) void guardar({ descripcion });
                  }}
                  rows={5}
                  className={`${INPUT_CLS} mt-2 min-h-[110px] resize-y`}
                  placeholder="Detalle del ajuste. Podés pegar la captura acá con Ctrl/Cmd+V."
                />
              </Tarjeta>

              <Tarjeta titulo="Capturas">
                {imagenes.length > 0 ? (
                  <ul className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {imagenes.map((a, idx) => (
                      <li key={a.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => setLightboxIdx(idx)}
                          className="block aspect-square w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                          aria-label={`Ver ${a.nombre}`}
                        >
                          {a.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.url} alt={a.nombre} className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-slate-300">
                              <IconImage size={20} />
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void eliminarArchivo(a)}
                          aria-label={`Eliminar ${a.nombre}`}
                          className="absolute right-1 top-1 hidden rounded-md bg-white/90 p-1 text-slate-500 shadow-sm transition-colors hover:text-rose-600 group-hover:block"
                        >
                          <IconTrash size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {adjuntosNoImagen.length > 0 ? (
                  <ul className="mb-2 space-y-1">
                    {adjuntosNoImagen.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                      >
                        <a
                          href={a.url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 flex-1 truncate text-slate-700 hover:text-[#3F8E91]"
                        >
                          {a.nombre}
                        </a>
                        <button
                          type="button"
                          onClick={() => void eliminarArchivo(a)}
                          className="rounded-md p-1 text-slate-400 transition-colors hover:text-rose-600"
                          aria-label={`Eliminar ${a.nombre}`}
                        >
                          <IconTrash size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <QAImageDropzone
                  id={obsId}
                  capturarPaste={lightboxIdx === null}
                  subiendo={subiendo}
                  onArchivos={(archivos) => void subirArchivos(archivos)}
                />
              </Tarjeta>

              {/*
                Conversación técnica: UN solo hilo con QA y Desarrollo
                intercalados por fecha, como se lee una conversación. El carril
                del mensaje ya no depende de en qué caja se escribió sino de
                QUIÉN escribe: antes había dos cajas y cualquiera podía publicar
                haciéndose pasar por el otro.
              */}
              <Tarjeta titulo="Conversación técnica" subtitulo="Visible para QA y Desarrollo">
                <HiloComentario
                  titulo=""
                  colorAvatar="bg-[#0B3A3D]/10 text-[#0B3A3D]"
                  colorAcento="border-l-[#7DCFD2]"
                  comentarios={comentariosTecnicos}
                  cargando={comentariosCargando}
                  vacio="Todavía no hay mensajes."
                  borrador={nuevoComentarioTecnico}
                  onBorrador={setNuevoComentarioTecnico}
                  placeholder={
                    vista === "qa"
                      ? "Escribí una indicación para el técnico… (Ctrl/Cmd+Enter para enviar)"
                      : "Escribí una actualización para QA… (Ctrl/Cmd+Enter para enviar)"
                  }
                  onEnviar={() => void publicarComentario(vista === "qa" ? "qa" : "tecnico")}
                  usuarioId={usuarioId}
                  onEditar={(c, t) => void editarComentario(c, t)}
                  onEliminar={(c) => void eliminarComentario(c)}
                />
              </Tarjeta>
            </div>

            {/* ------------------------- DERECHA ------------------------- */}
            <div className="space-y-4">
              <Tarjeta titulo="Información">
                <div className="space-y-3">
                  <div>
                    <span className={LABEL_CLS}>Estado</span>
                    {/*
                      Grilla de 3 y no una fila: con cinco estados en la columna
                      angosta, "En curso" partía en dos líneas y descuadraba
                      todo el control.
                    */}
                    <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                      {QA_ESTADOS.filter(
                        (e) => vista === "qa" || (e.codigo !== "verificado" && e.codigo !== "descartado")
                      ).map((e) => {
                        const activo = obs.estado === e.codigo;
                        return (
                          <button
                            key={e.codigo}
                            type="button"
                            onClick={() => void cambiarEstado(e.codigo)}
                            className={`truncate rounded-md px-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
                              activo ? "text-white shadow-sm" : "text-slate-500 hover:bg-white hover:text-slate-700"
                            }`}
                            title={e.label}
                            style={activo ? { backgroundColor: e.color } : undefined}
                          >
                            {e.corto}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <span className={LABEL_CLS}>Asignado a</span>
                    <div className="mt-1.5">
                      <FiltroSelect
                        etiqueta="Asignada a"
                        valor={obs.asignado_a ?? ""}
                        activo={Boolean(obs.asignado_a)}
                        bloque
                        onChange={(v) => void guardar({ asignado_a: v || null })}
                      >
                        <option value="">Sin asignar</option>
                        {usuarios.map((u) => (
                          <option key={u.id} value={u.id}>
                            {(u.nombre ?? "").trim() || (u.email ?? "").trim() || "Usuario"}
                          </option>
                        ))}
                      </FiltroSelect>
                    </div>
                  </div>

                  <div>
                    <span className={LABEL_CLS}>Sección</span>
                    <div className="mt-1.5">
                      <SeccionCombobox
                        secciones={secciones}
                        valor={obs.seccion_id}
                        onElegir={(id) => void guardar({ seccion_id: id })}
                        onCrear={(nombre) => void crearYAsignarSeccion(nombre)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className={LABEL_CLS}>Severidad</span>
                      <div className="mt-1.5">
                        <FiltroSelect
                          etiqueta="Severidad"
                          valor={obs.severidad}
                          activo={obs.severidad === "bloqueante" || obs.severidad === "alta"}
                          bloque
                          onChange={(v) => void guardar({ severidad: v as QAObservacionSeveridad })}
                        >
                          {QA_SEVERIDADES.map((sv) => (
                            <option key={sv.codigo} value={sv.codigo}>
                              {sv.label}
                            </option>
                          ))}
                        </FiltroSelect>
                      </div>
                    </div>
                    <div>
                      <span className={LABEL_CLS}>Origen</span>
                      <div className="mt-1.5">
                        <FiltroSelect
                          etiqueta="Origen"
                          valor={obs.origen}
                          activo={obs.origen === "cliente"}
                          bloque
                          onChange={(v) => void guardar({ origen: v as QAObservacionOrigen })}
                        >
                          {QA_ORIGENES.map((o) => (
                            <option key={o.codigo} value={o.codigo}>
                              {o.label}
                            </option>
                          ))}
                        </FiltroSelect>
                      </div>
                    </div>
                  </div>

                  <div>
                    <span className={LABEL_CLS}>Fecha límite</span>
                    <input
                      type="date"
                      value={obs.fecha_limite ?? ""}
                      onChange={(e) => void guardar({ fecha_limite: e.target.value || null })}
                      className={`${INPUT_CLS} mt-1.5 py-2`}
                    />
                  </div>

                  <div>
                    <span className={LABEL_CLS}>URL de referencia</span>
                    <input
                      value={urlRef}
                      onChange={(e) => setUrlRef(e.target.value)}
                      onBlur={() => {
                        if (urlRef.trim() !== (obs.url_referencia ?? "")) {
                          void guardar({ url_referencia: urlRef.trim() || null });
                        }
                      }}
                      placeholder="https://…"
                      className={`${INPUT_CLS} mt-1.5`}
                    />
                  </div>
                </div>
              </Tarjeta>

              {/*
                Seguimiento interno: hilo privado PM ↔ QA. Sólo se dibuja para
                quien tiene el permiso, pero lo que de verdad lo protege es la
                API — a Desarrollo estos comentarios no le llegan siquiera en la
                respuesta. Ver `qa-permisos.ts`.
              */}
              {puedeVerInterno ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-slate-900">Seguimiento interno</h4>
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                      <IconCandado />
                      Privado · Solo PM y QA
                    </span>
                  </div>
                  <HiloComentario
                    titulo=""
                    colorAvatar="bg-amber-100 text-amber-700"
                    colorAcento="border-l-amber-400"
                    comentarios={comentariosInternos}
                    cargando={comentariosCargando}
                    vacio="Sin comentarios internos."
                    borrador={nuevoComentarioInterno}
                    onBorrador={setNuevoComentarioInterno}
                    placeholder="Agregar comentario interno… (Ctrl/Cmd+Enter para enviar)"
                    onEnviar={() => void publicarComentario("interno")}
                    usuarioId={usuarioId}
                  onEditar={(c, t) => void editarComentario(c, t)}
                  onEliminar={(c) => void eliminarComentario(c)}
                  />
                  <p className="mt-2 text-[11px] text-amber-700">
                    Este contenido no es visible para Desarrollo.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------------
            Pie: a la izquierda cuándo se tocó por última vez, a la derecha la
            acción principal según quién mira. El corte real está en la API —
            el técnico no puede verificar aunque se forzara este botón.
        ---------------------------------------------------------------- */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <span className="text-[11px] text-slate-400">
            {obs.verificado_at
              ? `Verificada por ${obs.verificado_por_nombre ?? "—"} · ${fechaRelativa(obs.verificado_at)}`
              : obs.resuelto_at
                ? `Resuelta por ${obs.resuelto_por_nombre ?? "—"} · ${fechaRelativa(obs.resuelto_at)}`
                : `Última actualización: ${fechaRelativa(obs.updated_at)}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800"
            >
              Cancelar
            </button>
            {vista === "desarrollo" && obs.estado !== "resuelto" && obs.estado !== "verificado" ? (
              <button
                type="button"
                onClick={() => void cambiarEstado("resuelto")}
                className="rounded-lg bg-[#0B3A3D] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#104A4E]"
              >
                Enviar a revisión
              </button>
            ) : null}
            {vista === "qa" && obs.estado !== "verificado" ? (
              <button
                type="button"
                onClick={() => void cambiarEstado("verificado")}
                className="rounded-lg bg-[#0B3A3D] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#104A4E]"
              >
                Verificar y cerrar
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {lightboxIdx !== null && imagenes[lightboxIdx] ? (
        <Lightbox
          imagenes={imagenes}
          indice={lightboxIdx}
          onIndice={setLightboxIdx}
          onCerrar={() => setLightboxIdx(null)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Combo con autocompletado sobre las secciones del proyecto + alta al vuelo. */
function SeccionCombobox({
  secciones,
  valor,
  onElegir,
  onCrear,
}: {
  secciones: QASeccion[];
  valor: string | null;
  onElegir: (id: string | null) => void;
  onCrear: (nombre: string) => void;
}) {
  const elegida = valor ? secciones.find((s) => s.id === valor) ?? null : null;
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");

  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase();
    if (!q) return secciones;
    return secciones.filter((s) => s.nombre.toLowerCase().includes(q));
  }, [secciones, texto]);

  const exacta = secciones.some((s) => s.nombre.trim().toLowerCase() === texto.trim().toLowerCase());

  return (
    <div className="relative mt-1.5">
      <input
        value={abierto ? texto : elegida?.nombre ?? ""}
        placeholder="Sin sección"
        onFocus={() => {
          setTexto("");
          setAbierto(true);
        }}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => window.setTimeout(() => setAbierto(false), 120)}
        className={INPUT_CLS}
      />
      {abierto ? (
        <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onElegir(null);
                setAbierto(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-50"
            >
              Sin sección
            </button>
          </li>
          {filtradas.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onElegir(s.id);
                  setAbierto(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color ?? "#cbd5e1" }}
                />
                {s.nombre}
              </button>
            </li>
          ))}
          {texto.trim() && !exacta ? (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onCrear(texto.trim());
                  setAbierto(false);
                }}
                className="block w-full px-3 py-1.5 text-left font-medium text-[#3F8E91] hover:bg-slate-50"
              >
                Crear sección «{texto.trim()}»
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Un carril de comentarios dentro de una observación: su propia lista y su
 * propia caja de texto. `ObservacionModal` renderiza dos —"Nota de QA" y
 * "Respuesta del técnico"— con los mismos comentarios ya filtrados por
 * `origen`, cada uno con su color de acento para distinguirse de un vistazo.
 */
function HiloComentario({
  titulo,
  colorAvatar,
  colorAcento,
  comentarios,
  cargando,
  vacio,
  borrador,
  onBorrador,
  placeholder,
  onEnviar,
  usuarioId,
  onEditar,
  onEliminar,
}: {
  titulo: string;
  colorAvatar: string;
  colorAcento: string;
  comentarios: QAComentario[];
  cargando: boolean;
  vacio: string;
  borrador: string;
  onBorrador: (v: string) => void;
  placeholder: string;
  onEnviar: () => void;
  /** Quién mira: decide sobre qué comentarios se ofrecen editar y eliminar. */
  usuarioId: string | null;
  onEditar: (c: QAComentario, texto: string) => void;
  onEliminar: (c: QAComentario) => void;
}) {
  return (
    <div className={`space-y-2 border-l-2 pl-3 ${colorAcento}`}>
      <span className={LABEL_CLS}>{titulo}</span>
      {cargando ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : comentarios.length === 0 ? (
        <p className="text-xs text-slate-400">{vacio}</p>
      ) : (
        <ul className="space-y-2">
          {comentarios.map((c) => (
            <ComentarioItem
              key={c.id}
              comentario={c}
              colorAvatar={colorAvatar}
              esMio={usuarioId != null && c.autor_id === usuarioId}
              onEditar={onEditar}
              onEliminar={onEliminar}
            />
          ))}
        </ul>
      )}

      {/*
        El botón va DEBAJO y no al lado: en la columna angosta del Seguimiento
        interno se repartían el ancho y el placeholder quedaba partido en dos
        líneas contra un botón espachurrado.
      */}
      <div>
        <textarea
          value={borrador}
          onChange={(e) => onBorrador(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onEnviar();
            }
          }}
          rows={2}
          placeholder={placeholder}
          className={`${INPUT_CLS} min-h-[60px] resize-y`}
        />
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            onClick={onEnviar}
            disabled={!borrador.trim()}
            className="rounded-lg bg-[#0B3A3D] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#104A4E] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * Un comentario del hilo, con edición en el lugar.
 *
 * Editar y eliminar sólo se ofrecen sobre lo propio (`esMio`). Es una comodidad
 * de la UI, no la barrera: la API vuelve a comprobar la autoría en cada PATCH y
 * DELETE, así que esconder los botones no es de lo que depende la seguridad.
 */
function ComentarioItem({
  comentario: c,
  colorAvatar,
  esMio,
  onEditar,
  onEliminar,
}: {
  comentario: QAComentario;
  colorAvatar: string;
  esMio: boolean;
  onEditar: (c: QAComentario, texto: string) => void;
  onEliminar: (c: QAComentario) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(c.texto);

  // Si el comentario cambia por fuera (otra pestaña, recarga), el borrador
  // abierto se descarta: es preferible perder un tipeo a medias que guardar
  // encima de algo que ya no es lo que se estaba editando.
  useEffect(() => {
    if (!editando) setBorrador(c.texto);
  }, [c.texto, editando]);

  function confirmar() {
    const limpio = borrador.trim();
    if (limpio && limpio !== c.texto) onEditar(c, limpio);
    setEditando(false);
  }

  return (
    <li className="group flex gap-2">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${colorAvatar}`}
      >
        {iniciales(c.autor_nombre)}
      </span>
      <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-slate-800">{c.autor_nombre ?? "Usuario"}</span>
          <span className="text-[11px] text-slate-400">{fechaRelativa(c.created_at)}</span>
          {/* "editado" evita que un mensaje corregido parezca el original. */}
          {c.updated_at && c.updated_at !== c.created_at ? (
            <span className="text-[10px] italic text-slate-400">editado</span>
          ) : null}
          {esMio && !editando ? (
            <span className="ml-auto hidden gap-2 group-hover:flex">
              <button
                type="button"
                onClick={() => setEditando(true)}
                className="text-[11px] text-slate-400 transition-colors hover:text-[#0B3A3D]"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => onEliminar(c)}
                className="text-[11px] text-slate-400 transition-colors hover:text-rose-600"
              >
                Eliminar
              </button>
            </span>
          ) : null}
        </div>

        {editando ? (
          <div className="mt-1.5">
            <textarea
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  confirmar();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setBorrador(c.texto);
                  setEditando(false);
                }
              }}
              rows={2}
              autoFocus
              className={`${INPUT_CLS} min-h-[54px] resize-y text-sm`}
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setBorrador(c.texto);
                  setEditando(false);
                }}
                className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={!borrador.trim() || borrador.trim() === c.texto}
                className="rounded-lg bg-[#0B3A3D] px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#104A4E] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{c.texto}</p>
        )}
      </div>
    </li>
  );
}

/** Visor a pantalla completa, con flechas del teclado entre capturas. */
function Lightbox({
  imagenes,
  indice,
  onIndice,
  onCerrar,
}: {
  imagenes: QAArchivo[];
  indice: number;
  onIndice: (i: number) => void;
  onCerrar: () => void;
}) {
  const total = imagenes.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") onIndice((indice + 1) % total);
      if (e.key === "ArrowLeft") onIndice((indice - 1 + total) % total);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [indice, total, onIndice]);

  const actual = imagenes[indice];

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-slate-950/90 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      {actual.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={actual.url}
          alt={actual.nombre}
          className="max-h-[80vh] max-w-full rounded-lg object-contain"
        />
      ) : null}
      <div className="flex items-center gap-3 text-xs text-white/80">
        {total > 1 ? (
          <>
            <button
              type="button"
              onClick={() => onIndice((indice - 1 + total) % total)}
              className="rounded-lg bg-white/10 px-3 py-1.5 transition-colors hover:bg-white/20"
            >
              Anterior
            </button>
            <span className="tabular-nums">
              {indice + 1} / {total}
            </span>
            <button
              type="button"
              onClick={() => onIndice((indice + 1) % total)}
              className="rounded-lg bg-white/10 px-3 py-1.5 transition-colors hover:bg-white/20"
            >
              Siguiente
            </button>
          </>
        ) : null}
        <button type="button" onClick={onCerrar} className={BTN_GHOST_CLS}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
