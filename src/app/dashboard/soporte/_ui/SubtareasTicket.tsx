"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ListChecks, Play, RotateCcw, Send, XCircle } from "lucide-react";
import { ESTADOS_SUBTAREA, TRANSICIONES_SUBTAREA, subtareaAbierta, type EstadoSubtarea } from "@/lib/soporte/dominio";
import { useTicket } from "./TicketContexto";
import { apiSoporte, fechaHora, obtenerSubtareas, subtareasEnMemoria, type Persona } from "./api";
import { Aviso, Avatar, Boton, Insignia, TONOS, TONO_AREA, claseInput } from "./ui";

type Comentario = { id: string; contenido: string; es_rechazo_qa: boolean; created_at: string; autor: Persona | null };

type Subtarea = {
  id: string;
  numero: number;
  titulo: string;
  estado: EstadoSubtarea;
  asignado: Persona | null;
  created_at: string;
  finalizado_at: string | null;
  comentarios: Comentario[];
};

/**
 * Subtareas del ticket: hoy, las revisiones de QA.
 *
 * Se abren solas cuando el ticket pasa a "Listo para revisión". QA comenta acá
 * y cierra la revisión: "Cambios solicitados" (con comentario obligatorio)
 * devuelve el ticket a En proceso en una fase nueva; "Finalizado" deja pasarlo a Resuelto.
 */
export default function SubtareasTicket() {
  const { ticket, recargar } = useTicket();
  const [lista, setLista] = useState<Subtarea[] | null>(() => subtareasEnMemoria<Subtarea[]>(ticket.id) ?? null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (forzar = false) => {
    try {
      setLista(await obtenerSubtareas<Subtarea[]>(ticket.id, forzar));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las subtareas");
    }
  }, [ticket.id]);

  // Cada cambio del ticket (p. ej. pasar a "Listo para revisión") puede abrir una subtarea.
  // La primera vez sirve lo precargado; cada cambio posterior del ticket va a la base.
  const primeraCarga = useRef(true);
  useEffect(() => {
    void cargar(!primeraCarga.current);
    primeraCarga.current = false;
  }, [cargar, ticket.updated_at, ticket.estado_codigo]);

  if (lista == null) return error ? <Aviso>{error}</Aviso> : null;
  if (lista.length === 0) return null;

  const abiertas = lista.filter((s) => subtareaAbierta(s.estado)).length;

  return (
    <div className="mt-5 flex gap-3.5">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TONOS.violeta.suave} ${TONOS.violeta.texto}`} aria-hidden>
        <ListChecks className="h-4 w-4" strokeWidth={2.1} />
      </span>
      <div className="min-w-0 flex-1 border-b border-slate-100 pb-5">
        <h3 className="mb-3 text-[13.5px] font-bold text-slate-800">
          Subtareas
          <span className="ml-1.5 font-semibold text-slate-400">
            {abiertas ? `${abiertas} en revisión` : lista.every((s) => s.estado === "finalizado") ? "todas finalizadas" : "sin revisiones pendientes"}
          </span>
        </h3>
        <div className="space-y-3">
          {[...lista].reverse().map((s) => (
            <TarjetaSubtarea
              key={s.id}
              ticketId={ticket.id}
              sub={s}
              // Cambiar el estado toca el ticket: al recargarlo, el efecto de arriba trae las subtareas.
              alCambiar={(ticketCambio) => (ticketCambio ? recargar() : cargar(true))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TarjetaSubtarea({ ticketId, sub, alCambiar }: { ticketId: string; sub: Subtarea; alCambiar: (ticketCambio: boolean) => Promise<void> }) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const estado = ESTADOS_SUBTAREA.find((e) => e.codigo === sub.estado);
  const destinos = TRANSICIONES_SUBTAREA[sub.estado] ?? [];
  const abierta = subtareaAbierta(sub.estado);

  const url = `/api/soporte/tickets/${ticketId}/subtareas/${sub.id}`;

  const comentar = async () => {
    const contenido = texto.trim();
    if (!contenido) return;
    setOcupado("comentar");
    setError(null);
    try {
      await apiSoporte(`${url}/comentarios`, { method: "POST", json: { contenido } });
      setTexto("");
      await alCambiar(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo comentar");
    } finally {
      setOcupado(null);
    }
  };

  const cambiarEstado = async (hacia: EstadoSubtarea) => {
    const comentario = texto.trim();
    if (hacia === "cambios_solicitados" && !comentario) {
      setError("Escribí qué cambios hacen falta y después tocá “Solicitar cambios”.");
      return;
    }
    setOcupado(hacia);
    setError(null);
    try {
      await apiSoporte(url, { method: "PATCH", json: { estado: hacia, comentario: comentario || undefined } });
      setTexto("");
      await alCambiar(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el estado");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className={`rounded-xl border px-3.5 py-3 ${abierta ? "border-violet-200 bg-violet-50/30" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-[13.5px] font-bold text-slate-800">{sub.titulo}</p>
        {estado ? <Insignia color={estado.color} punto>{estado.nombre}</Insignia> : null}
        <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">
          {sub.asignado ? (
            <>
              <Avatar nombre={sub.asignado.nombre} tam={20} tono={TONO_AREA[sub.asignado.area]} />
              <span className="truncate font-medium text-slate-700">{sub.asignado.nombre}</span>
            </>
          ) : (
            <span className="italic text-slate-400">Sin QA asignado</span>
          )}
          <span className="text-slate-300" aria-hidden>·</span>
          <span>{fechaHora(sub.created_at)}</span>
        </span>
      </div>

      {sub.comentarios.length ? (
        <ol className="mt-3 space-y-2.5">
          {sub.comentarios.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <Avatar nombre={c.autor?.nombre} tam={26} tono={TONO_AREA[c.autor?.area ?? "Equipo"]} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px]">
                  <span className="font-bold text-slate-800">{c.autor?.nombre ?? "Usuario"}</span>
                  <span className="ml-2 text-slate-400">{fechaHora(c.created_at)}</span>
                </p>
                {c.es_rechazo_qa ? (
                  <div className="mt-1 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-600">
                      <XCircle className="h-3.5 w-3.5" aria-hidden /> Cambios solicitados
                    </p>
                    <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-rose-900">{c.contenido}</p>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-line rounded-xl rounded-tl-sm bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-700 ring-1 ring-slate-100">{c.contenido}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {abierta ? (
        <div className="mt-3 space-y-2">
          <textarea
            className={`${claseInput} min-h-20 bg-white`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía; Shift+Enter baja de renglón. Mientras se compone un acento no se envía.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void comentar();
              }
            }}
            placeholder="Comentario de la revisión… (Shift+Enter para otro renglón)"
            disabled={ocupado != null}
          />
          {error ? <Aviso>{error}</Aviso> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Boton variante="fantasma" tam="sm" onClick={() => void comentar()} cargando={ocupado === "comentar"} disabled={!texto.trim() || ocupado != null}>
              <Send className="h-3.5 w-3.5" aria-hidden /> Comentar
            </Boton>
            {destinos.includes("en_proceso") ? (
              <Boton variante="secundario" tam="sm" onClick={() => void cambiarEstado("en_proceso")} cargando={ocupado === "en_proceso"} disabled={ocupado != null}>
                <Play className="h-3.5 w-3.5" aria-hidden /> Empezar revisión
              </Boton>
            ) : null}
            {destinos.includes("cambios_solicitados") ? (
              <Boton
                variante="secundario"
                tam="sm"
                className="!border-orange-200 !text-orange-700 hover:!bg-orange-50"
                onClick={() => void cambiarEstado("cambios_solicitados")}
                cargando={ocupado === "cambios_solicitados"}
                disabled={ocupado != null}
                title="Devuelve el ticket a En proceso y abre una fase nueva. Requiere comentario."
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Solicitar cambios
              </Boton>
            ) : null}
            {destinos.includes("finalizado") ? (
              <Boton tam="sm" onClick={() => void cambiarEstado("finalizado")} cargando={ocupado === "finalizado"} disabled={ocupado != null}>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Finalizar
              </Boton>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
