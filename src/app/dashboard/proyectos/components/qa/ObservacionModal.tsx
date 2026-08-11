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
import type { QAApiResp, QAArchivo, QAComentario, QAObservacion, QASeccion, QAUsuario } from "./types";
import {
  BTN_GHOST_CLS,
  BTN_PRIMARY_CLS,
  INPUT_CLS,
  SELECT_CLS,
  IconImage,
  IconTrash,
  fechaRelativa,
  iniciales,
  textoSobre,
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
};

const LABEL_CLS = "text-[11px] font-medium uppercase tracking-wide text-slate-500";

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
}: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [titulo, setTitulo] = useState(obs.titulo);
  const [descripcion, setDescripcion] = useState(obs.descripcion ?? "");
  const [urlRef, setUrlRef] = useState(obs.url_referencia ?? "");

  const [comentarios, setComentarios] = useState<QAComentario[]>([]);
  const [comentariosCargando, setComentariosCargando] = useState(true);
  const [nuevoComentario, setNuevoComentario] = useState("");

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const enviandoRef = useRef(false);

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
    }> | null;
    if (res.ok && j?.success && j.data) {
      setComentarios(j.data.comentarios);
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

  async function cambiarEstado(estado: QAObservacionEstado) {
    if (estado === obs.estado) return;
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
      setErr(j?.error ?? "No se pudo cambiar el estado");
      return;
    }
    setErr(null);
    onActualizada(j.data);
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

  async function publicarComentario() {
    const texto = nuevoComentario.trim();
    if (!texto || enviandoRef.current) return;
    enviandoRef.current = true;
    try {
      const res = await fetchWithSupabaseSession(
        `/api/proyectos/${projectId}/qa/observaciones/${obsId}/comentarios`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto }),
        }
      );
      const j = (await res.json().catch(() => null)) as QAApiResp<QAComentario> | null;
      if (!res.ok || !j?.success || !j.data) {
        setErr(j?.error ?? "No se pudo comentar");
        return;
      }
      setErr(null);
      setNuevoComentario("");
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

  function agregarArchivo(a: QAArchivo) {
    onActualizada({ ...obs, archivos: [...obs.archivos, a] });
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
      <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-2xl">
        {/* Cabecera */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-slate-600">
            {qaCodigoObservacion(obs.numero)}
          </span>
          {seccionActual ? (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={
                seccionActual.color
                  ? { backgroundColor: seccionActual.color, color: textoSobre(seccionActual.color) }
                  : { backgroundColor: "#f1f5f9", color: "#475569" }
              }
            >
              {seccionActual.nombre}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => void eliminarObservacion()}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
              aria-label="Eliminar observación"
            >
              <IconTrash />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {err ? <p className="text-xs text-rose-600">{err}</p> : null}

          {/* Estados */}
          <div className="flex flex-wrap gap-1.5">
            {QA_ESTADOS.map((e) => {
              const activo = obs.estado === e.codigo;
              return (
                <button
                  key={e.codigo}
                  type="button"
                  onClick={() => void cambiarEstado(e.codigo)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    activo
                      ? "border-transparent text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                  style={activo ? { backgroundColor: e.color } : undefined}
                >
                  {e.label}
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-400">
            {obs.resuelto_at
              ? `Resuelta por ${obs.resuelto_por_nombre ?? "—"} · ${fechaRelativa(obs.resuelto_at)}`
              : "Todavía sin resolver"}
            {obs.verificado_at
              ? ` · Verificada por ${obs.verificado_por_nombre ?? "—"} · ${fechaRelativa(obs.verificado_at)}`
              : ""}
          </p>

          {/* Título + descripción */}
          <div className="space-y-2">
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
              className={`${INPUT_CLS} text-base font-medium`}
              placeholder="Qué hay que ajustar"
            />
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              onBlur={() => {
                if (descripcion !== (obs.descripcion ?? "")) void guardar({ descripcion });
              }}
              rows={4}
              className={`${INPUT_CLS} min-h-[96px] resize-y`}
              placeholder="Detalle del ajuste. Podés pegar la captura acá con Ctrl/Cmd+V."
            />
          </div>

          {/* Metadatos */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className={LABEL_CLS}>Sección</span>
              <SeccionCombobox
                secciones={secciones}
                valor={obs.seccion_id}
                onElegir={(id) => void guardar({ seccion_id: id })}
                onCrear={(nombre) => void crearYAsignarSeccion(nombre)}
              />
            </div>

            <div>
              <span className={LABEL_CLS}>Asignada a</span>
              <select
                value={obs.asignado_a ?? ""}
                onChange={(e) => void guardar({ asignado_a: e.target.value || null })}
                className={`${SELECT_CLS} mt-1.5 w-full`}
              >
                <option value="">Sin asignar</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.nombre ?? "").trim() || (u.email ?? "").trim() || "Usuario"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className={LABEL_CLS}>Severidad</span>
              <select
                value={obs.severidad}
                onChange={(e) =>
                  void guardar({ severidad: e.target.value as QAObservacionSeveridad })
                }
                className={`${SELECT_CLS} mt-1.5 w-full`}
              >
                {QA_SEVERIDADES.map((s) => (
                  <option key={s.codigo} value={s.codigo}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className={LABEL_CLS}>Origen</span>
              <select
                value={obs.origen}
                onChange={(e) => void guardar({ origen: e.target.value as QAObservacionOrigen })}
                className={`${SELECT_CLS} mt-1.5 w-full`}
              >
                {QA_ORIGENES.map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className={LABEL_CLS}>Fecha límite</span>
              <input
                type="date"
                value={obs.fecha_limite ?? ""}
                onChange={(e) => void guardar({ fecha_limite: e.target.value || null })}
                className={`${SELECT_CLS} mt-1.5 w-full`}
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

          {/* Galería */}
          <div className="space-y-2">
            <span className={LABEL_CLS}>Capturas</span>
            {imagenes.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
              <ul className="space-y-1">
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
              projectId={projectId}
              obsId={obsId}
              capturarPaste={lightboxIdx === null}
              onSubido={agregarArchivo}
              onError={setErr}
            />
          </div>

          {/* Comentarios */}
          <div className="space-y-2">
            <span className={LABEL_CLS}>Comentarios</span>
            {comentariosCargando ? (
              <p className="text-xs text-slate-400">Cargando…</p>
            ) : comentarios.length === 0 ? (
              <p className="text-xs text-slate-400">Sin comentarios todavía.</p>
            ) : (
              <ul className="space-y-2">
                {comentarios.map((c) => (
                  <li key={c.id} className="group flex gap-2">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4FAEB2]/15 text-[9px] font-semibold text-[#3F8E91]">
                      {iniciales(c.autor_nombre)}
                    </span>
                    <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium text-slate-800">
                          {c.autor_nombre ?? "Usuario"}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {fechaRelativa(c.created_at)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void eliminarComentario(c)}
                          className="ml-auto hidden text-[11px] text-slate-400 transition-colors hover:text-rose-600 group-hover:block"
                        >
                          Eliminar
                        </button>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{c.texto}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-start gap-2">
              <textarea
                value={nuevoComentario}
                onChange={(e) => setNuevoComentario(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void publicarComentario();
                  }
                }}
                rows={2}
                placeholder="Escribí una respuesta… (Ctrl/Cmd+Enter para enviar)"
                className={`${INPUT_CLS} min-h-[56px] resize-y`}
              />
              <button
                type="button"
                onClick={() => void publicarComentario()}
                disabled={!nuevoComentario.trim()}
                className={BTN_PRIMARY_CLS}
              >
                Enviar
              </button>
            </div>
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
