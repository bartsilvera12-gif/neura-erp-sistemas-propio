"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, MessageSquare, Paperclip, Pencil, Send, Trash2, X, XCircle } from "lucide-react";
import { useTicket } from "./TicketContexto";
import { apiSoporte, comentariosEnMemoria, fechaHora, obtenerComentarios, subirArchivos, type Persona } from "./api";
import { ARCHIVO_MAX_BYTES } from "@/lib/soporte/dominio";
import ZonaArchivos from "./ZonaArchivos";
import { Aviso, Avatar, Boton, Cargando, TONOS, TONO_AREA, Tarjeta, Vacio, claseInput } from "./ui";

type Adjunto = { id: string; nombre: string; mime_type: string | null; url: string | null };
type Comentario = {
  id: string;
  contenido: string;
  es_rechazo_qa: boolean;
  created_at: string;
  editado_at: string | null;
  parent_id: string | null;
  /** El usuario actual es el autor: puede editarlo/eliminarlo. */
  mio: boolean;
  autor: Persona | null;
  adjuntos: Adjunto[];
  /** Subcomentarios (respuestas). Solo en los comentarios top-level. */
  respuestas?: Comentario[];
};

/**
 * Comentarios del ticket: sólo la conversación humana. Se muestran en la
 * descripción del ticket (y en /comentarios, para enlaces viejos).
 *
 * Es otra cosa que el historial. Acá habla la gente; el historial es la
 * auditoría del sistema. Un comentario normal va liviano, sin caja; una
 * devolución de QA se destaca en rojo suave porque es lo que Desarrollo tiene
 * que leer primero al retomar. Cada comentario admite respuestas (hilo de 1
 * nivel) con sus propios adjuntos.
 */
export default function ComentariosTicket({ enTarjeta = true }: { enTarjeta?: boolean }) {
  const { ticket, recargar } = useTicket();
  // Lo precargado al pasar el mouse por la fila se pinta al instante.
  const [lista, setLista] = useState<Comentario[] | null>(() => comentariosEnMemoria<Comentario[]>(ticket.id) ?? null);
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [adjuntando, setAdjuntando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edición/eliminación de comentarios propios (sirve para top-level y respuestas).
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [textoEdit, setTextoEdit] = useState("");
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  // Composer de respuesta: abierto sobre un comentario padre a la vez.
  const [respondiendoId, setRespondiendoId] = useState<string | null>(null);
  const [textoResp, setTextoResp] = useState("");
  const [archivosResp, setArchivosResp] = useState<File[]>([]);
  const [adjuntandoResp, setAdjuntandoResp] = useState(false);
  const [enviandoResp, setEnviandoResp] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const cargar = useCallback(async (forzar = false) => {
    try {
      setLista(await obtenerComentarios<Comentario[]>(ticket.id, forzar));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los comentarios");
    }
  }, [ticket.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El textarea de edición crece con su contenido (hasta 60% de la pantalla) para
  // no tener que editar un comentario largo en una cajita con scroll.
  useEffect(() => {
    const el = editRef.current;
    if (!editandoId || !el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.6))}px`;
  }, [editandoId, textoEdit]);

  /**
   * Pegar una imagen (Ctrl+V) la adjunta directo, sin tener que guardarla antes.
   * Las capturas vienen sin nombre real ("image.png"): se renombran con la hora
   * para que se distingan entre sí. Sirve para el composer principal y el de
   * respuesta (se le pasa a qué lista agregar).
   */
  const pegarImagenes = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    setFiles: React.Dispatch<React.SetStateAction<File[]>>,
    abrirZona: () => void
  ) => {
    const imgs = Array.from(e.clipboardData?.items ?? []).filter(
      (it) => it.kind === "file" && it.type.startsWith("image/")
    );
    if (!imgs.length) return;
    const nuevos: File[] = [];
    for (const it of imgs) {
      const f = it.getAsFile();
      if (!f || f.size === 0 || f.size > ARCHIVO_MAX_BYTES) continue;
      const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const nombre = f.name && f.name.toLowerCase() !== "image.png"
        ? f.name
        : `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
      nuevos.push(new File([f], nombre, { type: f.type }));
    }
    if (!nuevos.length) return;
    e.preventDefault(); // no pegar el blob/el texto, solo adjuntar
    abrirZona();
    setFiles((prev) => [...prev, ...nuevos].slice(0, 20));
  };

  const comentar = async () => {
    const contenido = texto.trim();
    if (!contenido) return;
    setEnviando(true);
    setError(null);
    try {
      const creado = await apiSoporte<{ id: string }>(`/api/soporte/tickets/${ticket.id}/comentarios`, {
        method: "POST",
        json: { contenido },
      });
      if (archivos.length) {
        const r = await subirArchivos(ticket.id, archivos, { comentarioId: creado.id });
        if (r.errores.length) setError(`El comentario se guardó, pero no se subieron: ${r.errores.join(" · ")}`);
      }
      setTexto("");
      setArchivos([]);
      setAdjuntando(false);
      await Promise.all([cargar(true), recargar()]);
      requestAnimationFrame(() => finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo comentar");
    } finally {
      setEnviando(false);
    }
  };

  const abrirRespuesta = (parentId: string) => {
    setError(null);
    setRespondiendoId(parentId);
    setTextoResp("");
    setArchivosResp([]);
    setAdjuntandoResp(false);
  };

  const cerrarRespuesta = () => {
    setRespondiendoId(null);
    setTextoResp("");
    setArchivosResp([]);
    setAdjuntandoResp(false);
  };

  const responder = async (parentId: string) => {
    const contenido = textoResp.trim();
    if (!contenido) return;
    setEnviandoResp(true);
    setError(null);
    try {
      const creado = await apiSoporte<{ id: string }>(`/api/soporte/tickets/${ticket.id}/comentarios`, {
        method: "POST",
        json: { contenido, parent_id: parentId },
      });
      if (archivosResp.length) {
        const r = await subirArchivos(ticket.id, archivosResp, { comentarioId: creado.id });
        if (r.errores.length) setError(`La respuesta se guardó, pero no se subieron: ${r.errores.join(" · ")}`);
      }
      cerrarRespuesta();
      await Promise.all([cargar(true), recargar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo responder");
    } finally {
      setEnviandoResp(false);
    }
  };

  const empezarEdicion = (c: Comentario) => {
    setError(null);
    setEditandoId(c.id);
    setTextoEdit(c.contenido);
  };

  const guardarEdicion = async (cid: string) => {
    const contenidoEdit = textoEdit.trim();
    if (!contenidoEdit) return;
    setGuardandoEdit(true);
    setError(null);
    try {
      await apiSoporte(`/api/soporte/tickets/${ticket.id}/comentarios/${cid}`, {
        method: "PATCH",
        json: { contenido: contenidoEdit },
      });
      setEditandoId(null);
      setTextoEdit("");
      await cargar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo editar el comentario");
    } finally {
      setGuardandoEdit(false);
    }
  };

  const eliminar = async (cid: string) => {
    if (!window.confirm("¿Eliminar este comentario? No se puede deshacer.")) return;
    setEliminandoId(cid);
    setError(null);
    try {
      await apiSoporte(`/api/soporte/tickets/${ticket.id}/comentarios/${cid}`, { method: "DELETE" });
      if (editandoId === cid) setEditandoId(null);
      await Promise.all([cargar(true), recargar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar el comentario");
    } finally {
      setEliminandoId(null);
    }
  };

  // Adjuntos (imágenes como miniatura, el resto como chip). Reutilizado por
  // comentarios y respuestas.
  const renderAdjuntos = (adjuntos: Adjunto[]) => {
    const imagenes = adjuntos.filter((a) => (a.mime_type ?? "").startsWith("image/") && a.url);
    const otros = adjuntos.filter((a) => !((a.mime_type ?? "").startsWith("image/") && a.url));
    return (
      <>
        {imagenes.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {imagenes.map((a) => (
              <a key={a.id} href={a.url!} target="_blank" rel="noreferrer" className="block" aria-label={`Ver ${a.nombre}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url!}
                  alt={a.nombre}
                  loading="lazy"
                  className="h-28 w-28 rounded-xl border border-slate-200 object-cover shadow-sm transition hover:brightness-95 sm:h-36 sm:w-36"
                />
              </a>
            ))}
          </div>
        ) : null}
        {otros.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {otros.map((a) =>
              a.url ? (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-600 no-underline hover:bg-slate-50"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden /> {a.nombre}
                </a>
              ) : (
                <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-500">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden /> {a.nombre}
                </span>
              )
            )}
          </div>
        ) : null}
      </>
    );
  };

  // Cabecera + cuerpo + adjuntos de un comentario. Sirve para top-level y
  // respuestas (la respuesta usa avatar más chico via `compacto`).
  const renderCuerpo = (c: Comentario, opciones?: { permitirResponder?: boolean }) => (
    <div className="min-w-0 flex-1 pt-0.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
        <span className="font-bold text-slate-900">{c.autor?.nombre ?? "Usuario"}</span>
        <span
          className={`rounded-full px-2 py-px text-[10.5px] font-bold ${TONOS[TONO_AREA[c.autor?.area ?? "Equipo"] ?? "pizarra"].suave} ${TONOS[TONO_AREA[c.autor?.area ?? "Equipo"] ?? "pizarra"].texto}`}
        >
          {c.autor?.area ?? "Equipo"}
        </span>
        <span className="text-[12px] text-slate-400">{fechaHora(c.created_at)}</span>
        {c.editado_at ? <span className="text-[11px] italic text-slate-400">· editado</span> : null}
        {c.mio && !c.es_rechazo_qa && editandoId !== c.id ? (
          <span className="ml-auto inline-flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => empezarEdicion(c)}
              className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Editar comentario"
              title="Editar"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void eliminar(c.id)}
              disabled={eliminandoId === c.id}
              className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              aria-label="Eliminar comentario"
              title="Eliminar"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ) : null}
      </p>
      {editandoId === c.id ? (
        <div className="mt-1.5 space-y-2">
          <textarea
            ref={editRef}
            className={`${claseInput} min-h-[9rem] resize-none overflow-y-auto`}
            style={{ maxHeight: "60vh" }}
            value={textoEdit}
            onChange={(e) => setTextoEdit(e.target.value)}
            disabled={guardandoEdit}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void guardarEdicion(c.id);
              } else if (e.key === "Escape") {
                setEditandoId(null);
                setTextoEdit("");
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Boton tam="sm" onClick={() => void guardarEdicion(c.id)} cargando={guardandoEdit} disabled={!textoEdit.trim()}>
              <Check className="h-4 w-4" aria-hidden /> Guardar
            </Boton>
            <Boton variante="fantasma" tam="sm" onClick={() => { setEditandoId(null); setTextoEdit(""); }} disabled={guardandoEdit}>
              <X className="h-4 w-4" aria-hidden /> Cancelar
            </Boton>
          </div>
        </div>
      ) : c.es_rechazo_qa ? (
        <div className="mt-1.5 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-rose-600">
            <XCircle className="h-3.5 w-3.5" aria-hidden /> No confirmado
          </p>
          <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-rose-900">{c.contenido}</p>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-line rounded-2xl rounded-tl-md bg-slate-50 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-slate-700">{c.contenido}</p>
      )}
      {renderAdjuntos(c.adjuntos)}
      {opciones?.permitirResponder && editandoId !== c.id ? (
        <button
          type="button"
          onClick={() => (respondiendoId === c.id ? cerrarRespuesta() : abrirRespuesta(c.id))}
          className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-slate-400 transition hover:text-[#4FAEB2]"
        >
          <CornerDownRight className="h-3.5 w-3.5" aria-hidden /> Responder
        </button>
      ) : null}
    </div>
  );

  const contenido = (
    <>
      {lista == null ? (
        error ? <Aviso>{error}</Aviso> : <Cargando />
      ) : lista.length === 0 ? (
        enTarjeta ? (
          <Vacio icono={MessageSquare} titulo="Todavía no hay comentarios" detalle="Usá los comentarios para la conversación del equipo sobre este ticket." />
        ) : (
          <p className="text-[13px] italic text-slate-400">Todavía no hay comentarios.</p>
        )
      ) : (
        <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-slate-100">
          {lista.map((c) => {
            const tono = TONO_AREA[c.autor?.area ?? "Equipo"] ?? "pizarra";
            const respuestas = c.respuestas ?? [];
            return (
              <li key={c.id} className="relative flex gap-3">
                <span className="relative z-10 rounded-full ring-4 ring-white">
                  <Avatar nombre={c.autor?.nombre} tam={36} tono={tono} />
                </span>
                <div className="min-w-0 flex-1">
                  {renderCuerpo(c, { permitirResponder: true })}

                  {/* Respuestas (subcomentarios), indentadas bajo el comentario. */}
                  {respuestas.length ? (
                    <ul className="mt-3 space-y-3 border-l-2 border-slate-100 pl-3">
                      {respuestas.map((r) => {
                        const tonoR = TONO_AREA[r.autor?.area ?? "Equipo"] ?? "pizarra";
                        return (
                          <li key={r.id} className="flex gap-2.5">
                            <span className="shrink-0 pt-0.5">
                              <Avatar nombre={r.autor?.nombre} tam={28} tono={tonoR} />
                            </span>
                            {renderCuerpo(r)}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  {/* Composer de respuesta. */}
                  {respondiendoId === c.id ? (
                    <div className="mt-3 space-y-2 rounded-xl border border-[#4FAEB2]/25 bg-[#4FAEB2]/[0.05] p-3">
                      <textarea
                        className={`${claseInput} min-h-16`}
                        value={textoResp}
                        onChange={(e) => setTextoResp(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void responder(c.id);
                          } else if (e.key === "Escape") {
                            cerrarRespuesta();
                          }
                        }}
                        onPaste={(e) => pegarImagenes(e, setArchivosResp, () => setAdjuntandoResp(true))}
                        placeholder="Escribí una respuesta… (Shift+Enter para otro renglón)"
                        disabled={enviandoResp}
                        autoFocus
                      />
                      {adjuntandoResp ? <ZonaArchivos archivos={archivosResp} onCambio={setArchivosResp} compacta deshabilitada={enviandoResp} /> : null}
                      <div className="flex items-center justify-between gap-2">
                        <Boton variante="fantasma" tam="sm" onClick={() => setAdjuntandoResp((a) => !a)} disabled={enviandoResp}>
                          <Paperclip className="h-4 w-4" aria-hidden />
                          {archivosResp.length ? `${archivosResp.length} adjunto(s)` : "Adjuntar archivo"}
                        </Boton>
                        <div className="flex items-center gap-2">
                          <Boton variante="fantasma" tam="sm" onClick={cerrarRespuesta} disabled={enviandoResp}>
                            <X className="h-4 w-4" aria-hidden /> Cancelar
                          </Boton>
                          <Boton tam="sm" onClick={() => void responder(c.id)} cargando={enviandoResp} disabled={!textoResp.trim()}>
                            <Send className="h-4 w-4" aria-hidden /> Responder
                          </Boton>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div ref={finRef} className={`${enTarjeta ? "mt-6" : "mt-4"} space-y-3 rounded-2xl border border-[#4FAEB2]/25 bg-gradient-to-br from-[#4FAEB2]/[0.06] to-white p-4`}>
        <textarea
          className={`${claseInput} min-h-24`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter baja de renglón. Mientras se compone un acento no se envía.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void comentar();
            }
          }}
          onPaste={(e) => pegarImagenes(e, setArchivos, () => setAdjuntando(true))}
          placeholder="Escribí un comentario… (Shift+Enter para otro renglón)"
          disabled={enviando}
        />
        {adjuntando ? <ZonaArchivos archivos={archivos} onCambio={setArchivos} compacta deshabilitada={enviando} /> : null}
        {error && lista != null ? <Aviso>{error}</Aviso> : null}
        <div className="flex items-center justify-between gap-2">
          <Boton variante="fantasma" tam="sm" onClick={() => setAdjuntando((a) => !a)} disabled={enviando}>
            <Paperclip className="h-4 w-4" aria-hidden />
            {archivos.length ? `${archivos.length} adjunto(s)` : "Adjuntar archivo"}
          </Boton>
          <Boton onClick={() => void comentar()} cargando={enviando} disabled={!texto.trim()}>
            <Send className="h-4 w-4" aria-hidden /> Comentar
          </Boton>
        </div>
      </div>
    </>
  );
  return enTarjeta ? <Tarjeta>{contenido}</Tarjeta> : contenido;
}
