"use client";

import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  FilePlus2,
  History,
  FileX2,
  Flag,
  Link2,
  ListChecks,
  Lock,
  MessageSquare,
  Pencil,
  PlusCircle,
  RotateCcw,
  Tag,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTicket } from "../../../_ui/TicketContexto";
import { apiSoporte, fechaHora, type Persona } from "../../../_ui/api";
import { Aviso, Cargando, Tarjeta, Vacio } from "../../../_ui/ui";

type Evento = {
  id: string;
  tipo_evento: string;
  created_at: string;
  usuario: Persona | null;
  anterior: string | null;
  nuevo: string | null;
  metadata: Record<string, unknown> | null;
};

const CAMPOS_LEGIBLES: Record<string, string> = {
  asunto: "asunto",
  descripcion: "descripción",
  resultado_esperado: "resultado esperado",
  impacto_operativo: "impacto operativo",
  pasos_reproducir: "pasos para reproducir",
  criterios_aceptacion: "criterios de aceptación",
  modulo: "módulo",
  version: "versión",
  entorno: "entorno",
  navegador: "navegador",
};

/** Cómo se lee cada tipo de evento: ícono, tono y frase. */
function describir(e: Evento): { icono: LucideIcon; tono: string; titulo: React.ReactNode; detalle?: React.ReactNode } {
  const quien = e.usuario?.nombre ?? "Sistema";
  const cambio = (etq: string) =>
    e.anterior || e.nuevo ? (
      <>
        {etq}: <span className="text-slate-500">{e.anterior ?? "—"}</span> → <span className="font-medium text-slate-700">{e.nuevo ?? "—"}</span>
      </>
    ) : null;

  switch (e.tipo_evento) {
    case "creacion":
      return { icono: PlusCircle, tono: "bg-[#4FAEB2]", titulo: <><strong>Ticket creado</strong> por {quien}</>, detalle: e.nuevo ? `Estado inicial: ${e.nuevo}` : undefined };
    case "cambio_estado":
      return { icono: ArrowRightLeft, tono: "bg-sky-500", titulo: <><strong>Cambio de estado</strong> por {quien}</>, detalle: cambio("Estado") };
    case "entrega_qa":
      return { icono: Flag, tono: "bg-violet-500", titulo: <><strong>Listo para revisión</strong> por {quien}</>, detalle: cambio("Estado") };
    case "devolucion_qa":
      return { icono: XCircle, tono: "bg-rose-500", titulo: <><strong>QA pidió cambios</strong> ({quien})</>, detalle: cambio("Estado") };
    case "confirmacion_qa":
      return { icono: CheckCircle2, tono: "bg-emerald-500", titulo: <><strong>QA confirmó la resolución</strong> ({quien})</>, detalle: cambio("Estado") };
    case "cierre":
      return { icono: Lock, tono: "bg-slate-700", titulo: <><strong>Ticket cerrado</strong> por {quien}</>, detalle: cambio("Estado") };
    case "cancelacion":
      return { icono: XCircle, tono: "bg-rose-500", titulo: <><strong>Ticket cancelado</strong> por {quien}</>, detalle: cambio("Estado") };
    case "subtarea_creada":
      return { icono: ListChecks, tono: "bg-violet-500", titulo: <><strong>Subtarea creada: {e.nuevo}</strong></>, detalle: "Asignada a QA" };
    case "subtarea_estado":
      return {
        icono: ListChecks,
        tono: e.metadata?.titulo ? "bg-violet-500" : "bg-slate-400",
        titulo: <><strong>{String(e.metadata?.titulo ?? "Subtarea")}</strong> · {quien}</>,
        detalle: cambio("Estado"),
      };
    case "reapertura":
      return { icono: RotateCcw, tono: "bg-amber-500", titulo: <><strong>Ticket reabierto</strong> por {quien}</>, detalle: cambio("Estado") };
    case "cambio_responsable":
      return {
        icono: UserRound,
        tono: "bg-sky-500",
        titulo: e.nuevo ? <><strong>Asignado a {e.nuevo}</strong> por {quien}</> : <><strong>Responsable quitado</strong> por {quien}</>,
        detalle: e.anterior ? cambio("Responsable") : undefined,
      };
    case "cambio_prioridad":
      return { icono: Flag, tono: "bg-amber-500", titulo: <><strong>Cambio de prioridad</strong> por {quien}</>, detalle: cambio("Prioridad") };
    case "cambio_clasificacion":
      return { icono: Tag, tono: "bg-indigo-500", titulo: <><strong>Cambio de clasificación</strong> por {quien}</>, detalle: cambio("Clasificación") };
    case "cambio_tipo":
      return { icono: Tag, tono: "bg-indigo-500", titulo: <><strong>Cambio de tipo</strong> por {quien}</>, detalle: cambio("Tipo") };
    case "cambio_sla":
      return { icono: Clock, tono: "bg-indigo-500", titulo: <><strong>SLA recalculado</strong></>, detalle: cambio("SLA") };
    case "cambio_fecha_objetivo":
      return { icono: CalendarClock, tono: "bg-slate-500", titulo: <><strong>Cambio de fecha objetivo</strong> por {quien}</>, detalle: cambio("Fecha objetivo") };
    case "cambio_proxima_accion":
      return { icono: Pencil, tono: "bg-slate-500", titulo: <><strong>Próxima acción actualizada</strong> por {quien}</>, detalle: e.nuevo ?? "—" };
    case "edicion": {
      const campos = (e.metadata?.campos as string[] | undefined) ?? [];
      return {
        icono: Pencil,
        tono: "bg-slate-500",
        titulo: <><strong>Ticket editado</strong> por {quien}</>,
        detalle: campos.length ? `Campos: ${campos.map((c) => CAMPOS_LEGIBLES[c] ?? c).join(", ")}` : undefined,
      };
    }
    case "comentario":
      return {
        icono: MessageSquare,
        tono: e.metadata?.rechazo_qa ? "bg-rose-500" : "bg-slate-400",
        titulo: <><strong>{e.metadata?.rechazo_qa ? "Observación de QA agregada" : "Comentario agregado"}</strong> por {quien}</>,
      };
    case "archivo_agregado":
      return { icono: FilePlus2, tono: "bg-slate-400", titulo: <><strong>Archivo adjunto</strong> por {quien}</>, detalle: e.nuevo };
    case "archivo_eliminado":
      return { icono: FileX2, tono: "bg-rose-400", titulo: <><strong>Archivo eliminado</strong> por {quien}</>, detalle: e.anterior };
    case "relacion_agregada":
      return { icono: Link2, tono: "bg-slate-400", titulo: <><strong>Vinculado con {e.nuevo}</strong> por {quien}</> };
    case "relacion_eliminada":
      return { icono: Link2, tono: "bg-slate-400", titulo: <><strong>Vínculo con {e.anterior} quitado</strong> por {quien}</> };
    default:
      return { icono: Clock, tono: "bg-slate-400", titulo: <><strong>{e.tipo_evento}</strong> · {quien}</> };
  }
}

/**
 * Historial: la auditoría del ticket, en orden.
 *
 * Nada de lo que se ve acá se puede editar ni borrar —la base no lo permite—,
 * así que es la fuente confiable de qué pasó, cuándo y quién lo hizo.
 */
export default function TicketHistorialPage() {
  const { ticket } = useTicket();
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    apiSoporte<Evento[]>(`/api/soporte/tickets/${ticket.id}/historial`)
      .then((d) => vivo && setEventos(d))
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
    // Se recarga cuando el ticket cambia (updated_at), no sólo al entrar.
  }, [ticket.id, ticket.updated_at]);

  return (
    <Tarjeta>
      {eventos == null ? (
        error ? <Aviso>{error}</Aviso> : <Cargando />
      ) : eventos.length === 0 ? (
        <Vacio icono={History} tono="indigo" titulo="Sin eventos registrados" />
      ) : (
        <ol className="relative space-y-5 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-slate-200">
          {eventos.map((e) => {
            const d = describir(e);
            const Icono = d.icono;
            return (
              <li key={e.id} className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-3 sm:grid-cols-[32px_150px_minmax(0,1fr)]">
                <span className={`relative z-10 grid h-8 w-8 place-items-center rounded-full text-white ring-4 ring-white ${d.tono}`}>
                  <Icono className="h-4 w-4" aria-hidden />
                </span>
                <span className="hidden pt-1.5 text-[12px] tabular-nums text-slate-400 sm:block">{fechaHora(e.created_at)}</span>
                <div className="min-w-0 pt-1">
                  <p className="text-[13.5px] text-slate-700 [&_strong]:font-semibold [&_strong]:text-slate-900">{d.titulo}</p>
                  {d.detalle ? <p className="mt-0.5 text-[12.5px] text-slate-500">{d.detalle}</p> : null}
                  <p className="mt-0.5 text-[11.5px] tabular-nums text-slate-400 sm:hidden">{fechaHora(e.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Tarjeta>
  );
}
