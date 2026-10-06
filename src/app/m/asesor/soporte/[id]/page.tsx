"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftRight, ArrowUp, ChevronLeft, Download, ExternalLink, FileText, Film, ImageIcon, Loader2, Maximize2, Music, X } from "lucide-react";
import { apiSoporte, obtenerArchivos, subirArchivos } from "@/app/dashboard/soporte/_ui/api";
import ZonaArchivos from "@/app/dashboard/soporte/_ui/ZonaArchivos";
import { numeroTicket, tamanoLegible, TRANSICIONES } from "@/lib/soporte/dominio";
import { Chip, slaVencido, tonoEstado, tonoPrioridad, type PersonaSoporte, type TicketMovil } from "../_comun";

type Comentario = {
  id: string;
  contenido: string | null;
  es_rechazo_qa?: boolean | null;
  created_at: string | null;
  autor: PersonaSoporte | null;
};
type Subtarea = { id: string; titulo: string | null; estado: string | null; asignado: PersonaSoporte | null };
type Archivo = {
  id: string;
  nombre: string;
  descripcion: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  subido_por: { nombre: string } | null;
  url: string | null;
  url_descarga: string | null;
};
type Item = { codigo: string; nombre: string; activo?: boolean | null; sort_order?: number | null };

const fechaHora = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-PY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

const legible = (s?: string | null) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

/** Detalle de un ticket, con las acciones de la app nativa: estado, prioridad y comentarios. */
export default function MAsesorTicketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ticket, setTicket] = useState<TicketMovil | null>(null);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [subtareas, setSubtareas] = useState<Subtarea[]>([]);
  const [archivosTicket, setArchivosTicket] = useState<Archivo[] | null>(null);
  const [nuevosArchivos, setNuevosArchivos] = useState<File[]>([]);
  const [subiendoArchivos, setSubiendoArchivos] = useState<string | null>(null);
  const [estados, setEstados] = useState<Item[]>([]);
  const [prioridades, setPrioridades] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [texto, setTexto] = useState("");
  const [menuEstado, setMenuEstado] = useState(false);
  // Imagen abierta en el visor a pantalla completa (lightbox). En la APK no se puede abrir en
  // "otra pestaña" (queda la pantalla en negro), así que se muestra DENTRO de la app.
  const [imagenAmpliada, setImagenAmpliada] = useState<Archivo | null>(null);

  // Descarga: dispara la URL firmada con Content-Disposition: attachment (`url_descarga`). En la
  // APK la captura el DownloadListener nativo (MainActivity) y la guarda en "Descargas"; en el
  // navegador normal se descarga como siempre.
  const descargar = (a: Archivo) => {
    const url = a.url_descarga ?? a.url;
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const cargar = useCallback(async () => {
    const orden = (a: Item, b: Item) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
    await Promise.all([
      apiSoporte<{ ticket: TicketMovil }>(`/api/soporte/tickets/${id}`)
        .then((r) => {
          setTicket(r.ticket);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
      apiSoporte<Comentario[]>(`/api/soporte/tickets/${id}/comentarios`).then(setComentarios).catch(() => {}),
      apiSoporte<Subtarea[]>(`/api/soporte/tickets/${id}/subtareas`).then(setSubtareas).catch(() => {}),
      obtenerArchivos<Archivo[]>(id).then(setArchivosTicket).catch(() => setArchivosTicket([])),
      apiSoporte<{ estados: Item[]; prioridades: Item[] }>("/api/soporte/catalogos")
        .then((c) => {
          setEstados((c.estados ?? []).filter((x) => x.activo !== false).sort(orden));
          setPrioridades((c.prioridades ?? []).filter((x) => x.activo !== false).sort(orden));
        })
        .catch(() => {}),
    ]);
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Las acciones escriben en el ERP. Si el servidor frena (subtareas pendientes, falta
  // responsable…) su mensaje es el que explica por qué, así que se muestra tal cual.
  const ejecutar = async (accion: () => Promise<unknown>) => {
    if (guardando) return;
    setGuardando(true);
    setMensaje(null);
    try {
      await accion();
      await cargar();
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  const destinos = ticket ? estados.filter((e) => (TRANSICIONES[ticket.estado_codigo] ?? []).includes(e.codigo)) : [];

  const subirNuevosArchivos = async () => {
    if (!nuevosArchivos.length || subiendoArchivos) return;
    setMensaje(null);
    setSubiendoArchivos(`Subiendo 0 de ${nuevosArchivos.length}…`);
    try {
      const r = await subirArchivos(id, nuevosArchivos, {
        alAvanzar: (hechos, total) => setSubiendoArchivos(`Subiendo ${hechos} de ${total}…`),
      });
      setNuevosArchivos([]);
      setArchivosTicket(await obtenerArchivos<Archivo[]>(id, true));
      if (r.errores.length) setMensaje(r.errores.join(" · "));
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se pudieron subir los archivos");
    } finally {
      setSubiendoArchivos(null);
    }
  };

  const volver = () => {
    if (window.history.length > 1) router.back();
    else router.push("/m/asesor/soporte");
  };

  return (
    <div className="flex h-svh min-h-0 flex-col bg-slate-50">
      <header
        className="z-10 flex shrink-0 items-start gap-2 bg-[#3F8E91] px-2 pb-3 text-white shadow-sm"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.625rem)" }}
      >
        <button type="button" onClick={volver} aria-label="Volver" className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-white/15">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="line-clamp-2 text-[15px] font-semibold leading-tight">{ticket?.asunto ?? "Ticket"}</h1>
          <p className="text-[11px] tabular-nums text-white/80">{ticket ? numeroTicket(ticket.numero) : ""}</p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuEstado((v) => !v)}
            disabled={!ticket || guardando}
            aria-label="Cambiar estado"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/15 active:bg-white/25 disabled:opacity-50"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
          </button>
          {menuEstado ? (
            <>
              <button type="button" aria-label="Cerrar" className="fixed inset-0 z-20 cursor-default" onClick={() => setMenuEstado(false)} />
              <div className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-xl">
                {destinos.length === 0 ? (
                  <p className="px-3 py-2 text-[13px] text-slate-500">Sin cambios posibles desde este estado</p>
                ) : (
                  destinos.map((e) => (
                    <button
                      key={e.codigo}
                      type="button"
                      onClick={() => {
                        setMenuEstado(false);
                        void ejecutar(() => apiSoporte(`/api/soporte/tickets/${id}`, { method: "PATCH", json: { estado_codigo: e.codigo } }));
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[14px] active:bg-slate-50"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tonoEstado(e.codigo).solido }} />
                      {e.nombre}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-3 py-3">
        {!ticket ? (
          error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
          ) : (
            <p className="p-6 text-center text-sm text-slate-400 animate-pulse">Cargando…</p>
          )
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Chip texto={ticket.estado_nombre ?? ticket.estado_codigo} tono={tonoEstado(ticket.estado_codigo)} />
              {ticket.prioridad_nombre ? <Chip texto={ticket.prioridad_nombre} tono={tonoPrioridad(ticket.prioridad_codigo)} /> : null}
              {slaVencido(ticket) ? <Chip texto="SLA vencido" tono={tonoPrioridad("urgente")} /> : null}
            </div>

            <Panel titulo="Ticket">
              <Fila etiqueta="Cliente" valor={ticket.cliente_nombre} />
              <Fila etiqueta="Proyecto" valor={ticket.proyecto_titulo} />
              <Fila etiqueta="Tipo" valor={ticket.tipo_etiqueta} />
              <Fila etiqueta="Clasificación" valor={ticket.clasificacion_nombre} />
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-[14px] text-slate-500">Prioridad</span>
                <select
                  value={ticket.prioridad_codigo ?? ""}
                  disabled={guardando || prioridades.length === 0}
                  onChange={(e) =>
                    void ejecutar(() => apiSoporte(`/api/soporte/tickets/${id}`, { method: "PATCH", json: { prioridad_codigo: e.target.value } }))
                  }
                  className="rounded-lg bg-transparent text-right text-[14px] font-semibold outline-none"
                  style={{ color: tonoPrioridad(ticket.prioridad_codigo).color }}
                  aria-label="Prioridad"
                >
                  {!ticket.prioridad_codigo ? <option value="">—</option> : null}
                  {prioridades.map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <Fila etiqueta="A cargo" valor={ticket.responsable?.nombre} />
              <Fila etiqueta="Objetivo" valor={fechaHora(ticket.fecha_objetivo)} alerta={slaVencido(ticket)} />
            </Panel>

            {ticket.descripcion ? (
              <Panel titulo="Descripción">
                <p className="whitespace-pre-wrap text-[14px] text-slate-800">{ticket.descripcion}</p>
              </Panel>
            ) : null}

            {ticket.proxima_accion ? (
              <Panel titulo="Próxima acción">
                <p className="whitespace-pre-wrap text-[14px] text-slate-800">{ticket.proxima_accion}</p>
              </Panel>
            ) : null}

            <Panel titulo="Archivos">
              {archivosTicket == null ? (
                <p className="text-[12px] text-slate-500">Cargando archivos…</p>
              ) : archivosTicket.length === 0 ? (
                <p className="text-[12px] text-slate-500">Todavía no hay archivos adjuntos.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {archivosTicket.map((a) => {
                    const tipo = a.mime_type ?? "";
                    const esImagen = tipo.startsWith("image/");
                    const esVideo = tipo.startsWith("video/");
                    const esAudio = tipo.startsWith("audio/");
                    const Icono = esImagen ? ImageIcon : esVideo ? Film : esAudio ? Music : FileText;
                    return (
                      <div key={a.id} className="py-2">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
                            <Icono className="h-4 w-4" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-slate-800">{a.nombre}</p>
                            <p className="text-[11px] text-slate-400">
                              {a.subido_por?.nombre ?? "Usuario"} · {tamanoLegible(a.size_bytes)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {a.url_descarga || a.url ? (
                              <button
                                type="button"
                                onClick={() => descargar(a)}
                                aria-label={`Descargar ${a.nombre}`}
                                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 active:bg-slate-50"
                              >
                                <Download className="h-4 w-4" aria-hidden />
                              </button>
                            ) : null}
                            {a.url && esImagen ? (
                              <button
                                type="button"
                                onClick={() => setImagenAmpliada(a)}
                                aria-label={`Ampliar ${a.nombre}`}
                                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 active:bg-slate-50"
                              >
                                <Maximize2 className="h-4 w-4" aria-hidden />
                              </button>
                            ) : a.url ? (
                              <a
                                href={a.url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Abrir ${a.nombre}`}
                                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 active:bg-slate-50"
                              >
                                <ExternalLink className="h-4 w-4" aria-hidden />
                              </a>
                            ) : null}
                          </div>
                        </div>

                        {/* Previsualización inline según el tipo. `a.url` ya viene lista para mostrar
                            (la misma que usa el escritorio), así la imagen/video/audio se ve DENTRO del
                            ticket en vez de solo un ícono con un enlace. */}
                        {a.url && esImagen ? (
                          <button
                            type="button"
                            onClick={() => setImagenAmpliada(a)}
                            aria-label={`Ampliar ${a.nombre}`}
                            className="mt-2 block w-full"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={a.url}
                              alt={a.nombre}
                              loading="lazy"
                              className="max-h-72 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain"
                            />
                          </button>
                        ) : a.url && esVideo ? (
                          <video
                            src={a.url}
                            controls
                            preload="metadata"
                            className="mt-2 w-full rounded-xl border border-slate-200 bg-black"
                          />
                        ) : a.url && esAudio ? (
                          <audio src={a.url} controls preload="metadata" className="mt-2 w-full" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 border-t border-slate-100 pt-3">
                <ZonaArchivos
                  archivos={nuevosArchivos}
                  onCambio={setNuevosArchivos}
                  compacta
                  deshabilitada={!!subiendoArchivos}
                />
                {nuevosArchivos.length ? (
                  <button
                    type="button"
                    disabled={!!subiendoArchivos}
                    onClick={() => void subirNuevosArchivos()}
                    className="mt-3 w-full rounded-xl bg-[#3F8E91] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                  >
                    {subiendoArchivos ?? `Subir ${nuevosArchivos.length} archivo(s)`}
                  </button>
                ) : null}
              </div>
            </Panel>

            {subtareas.length > 0 ? (
              <Panel titulo="Subtareas">
                {subtareas.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-slate-800">{s.titulo ?? "Subtarea"}</p>
                      {s.asignado?.nombre ? <p className="text-[12px] text-slate-500">{s.asignado.nombre}</p> : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{legible(s.estado)}</span>
                  </div>
                ))}
              </Panel>
            ) : null}

            <Panel titulo="Comentarios">
              <div className="flex items-end gap-2">
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={1}
                  placeholder="Escribí un comentario…"
                  className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[14px] outline-none focus:border-[#4FAEB2]"
                />
                <button
                  type="button"
                  aria-label="Enviar comentario"
                  disabled={guardando || !texto.trim()}
                  onClick={() => {
                    const c = texto.trim();
                    setTexto("");
                    void ejecutar(() => apiSoporte(`/api/soporte/tickets/${id}/comentarios`, { method: "POST", json: { contenido: c } }));
                  }}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3F8E91] text-white disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
              {comentarios.length === 0 ? (
                <p className="text-[12px] text-slate-500">Todavía no hay comentarios.</p>
              ) : (
                comentarios.map((c) => (
                  <div key={c.id} className="py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-slate-800">{c.autor?.nombre ?? "Alguien"}</span>
                      {c.autor?.area ? <span className="text-[11px] text-slate-500">{c.autor.area}</span> : null}
                      {c.es_rechazo_qa ? <Chip texto="Rechazo QA" tono={tonoPrioridad("urgente")} /> : null}
                      <span className="ml-auto text-[11px] text-slate-400">{fechaHora(c.created_at)}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[14px] text-slate-800">{c.contenido}</p>
                  </div>
                ))
              )}
            </Panel>
          </>
        )}
      </main>

      {mensaje ? (
        <button
          type="button"
          onClick={() => setMensaje(null)}
          className="fixed inset-x-4 z-40 rounded-2xl bg-rose-600 px-4 py-3 text-center text-[13px] text-white shadow-lg"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
        >
          {mensaje}
        </button>
      ) : null}

      {/* Visor de imagen a pantalla completa (lightbox), dentro de la app. Tocar la imagen,
          el fondo o la X cierra. Evita abrir en "otra pestaña", que en la APK queda en negro. */}
      {imagenAmpliada?.url ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          role="dialog"
          aria-modal="true"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="truncate pr-3 text-[13px] font-medium">{imagenAmpliada.nombre}</span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => descargar(imagenAmpliada)}
                aria-label="Descargar"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 active:bg-white/20"
              >
                <Download className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setImagenAmpliada(null)}
                aria-label="Cerrar"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 active:bg-white/20"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setImagenAmpliada(null)}
            aria-label="Cerrar"
            className="flex min-h-0 flex-1 items-center justify-center p-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imagenAmpliada.url}
              alt={imagenAmpliada.nombre}
              className="max-h-full max-w-full object-contain"
            />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{titulo}</h2>
      {children}
    </section>
  );
}

function Fila({ etiqueta, valor, alerta }: { etiqueta: string; valor?: string | null; alerta?: boolean }) {
  if (!valor) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[14px] text-slate-500">{etiqueta}</span>
      <span className={`text-right text-[14px] font-medium ${alerta ? "text-rose-600" : "text-slate-900"}`}>{valor}</span>
    </div>
  );
}
