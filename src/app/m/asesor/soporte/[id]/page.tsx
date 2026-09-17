"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftRight, ArrowUp, ChevronLeft, Loader2 } from "lucide-react";
import { apiSoporte } from "@/app/dashboard/soporte/_ui/api";
import { numeroTicket, TRANSICIONES } from "@/lib/soporte/dominio";
import { Chip, slaVencido, tonoEstado, tonoPrioridad, type PersonaSoporte, type TicketMovil } from "../_comun";

type Comentario = {
  id: string;
  contenido: string | null;
  es_rechazo_qa?: boolean | null;
  created_at: string | null;
  autor: PersonaSoporte | null;
};
type Subtarea = { id: string; titulo: string | null; estado: string | null; asignado: PersonaSoporte | null };
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
  const [estados, setEstados] = useState<Item[]>([]);
  const [prioridades, setPrioridades] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [texto, setTexto] = useState("");
  const [menuEstado, setMenuEstado] = useState(false);

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
