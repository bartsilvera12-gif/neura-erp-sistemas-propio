"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  FilePlus2,
  FileX2,
  Flag,
  History,
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
import { ESTADOS_SUBTAREA } from "@/lib/soporte/dominio";
import { useTicket } from "../../../_ui/TicketContexto";
import { historialEnMemoria, obtenerHistorial, type Persona } from "../../../_ui/api";
import { Aviso, Avatar, Cargando, Insignia, Tarjeta, Vacio } from "../../../_ui/ui";

type Evento = {
  id: string;
  tipo_evento: string;
  created_at: string;
  usuario: Persona | null;
  anterior: string | null;
  nuevo: string | null;
  metadata: Record<string, unknown> | null;
};

type Grupo = "estados" | "qa" | "comentarios" | "asignacion" | "otros";

const FILTROS: { id: Grupo | "todo"; etiqueta: string }[] = [
  { id: "todo", etiqueta: "Todo" },
  { id: "estados", etiqueta: "Estados" },
  { id: "qa", etiqueta: "Revisión QA" },
  { id: "comentarios", etiqueta: "Comentarios" },
  { id: "asignacion", etiqueta: "Asignación" },
  { id: "otros", etiqueta: "Otros cambios" },
];

const CAMPOS_LEGIBLES: Record<string, string> = {
  asunto: "asunto",
  descripcion: "descripción",
  modulo: "módulo",
};

type Vista = {
  icono: LucideIcon;
  /** Clases del círculo del ícono. */
  tono: string;
  grupo: Grupo;
  titulo: string;
  /** Cambio de valor: se muestra como "antes → después". */
  cambio?: { antes: string | null; despues: string | null; colores?: boolean };
  nota?: string | null;
};

/** Qué se muestra para cada tipo de evento. */
function describir(e: Evento): Vista {
  const estado = (titulo: string, icono: LucideIcon, tono: string, grupo: Grupo = "estados"): Vista => ({
    icono,
    tono,
    grupo,
    titulo,
    cambio: { antes: e.anterior, despues: e.nuevo, colores: true },
  });
  switch (e.tipo_evento) {
    case "creacion":
      return { icono: PlusCircle, tono: "bg-[#4FAEB2]/15 text-[#2F6E71]", grupo: "estados", titulo: "Ticket creado", cambio: e.nuevo ? { antes: null, despues: e.nuevo, colores: true } : undefined };
    case "cambio_estado":
      return estado("Cambió el estado", ArrowRightLeft, "bg-sky-100 text-sky-700");
    case "entrega_qa":
      return estado("Listo para revisión", Flag, "bg-violet-100 text-violet-700");
    case "devolucion_qa":
      return estado("QA pidió cambios", XCircle, "bg-rose-100 text-rose-700", "qa");
    case "confirmacion_qa":
      return estado("Resuelto tras la revisión", CheckCircle2, "bg-emerald-100 text-emerald-700");
    case "resuelto_guardia":
      return { ...estado("Resuelto en guardia", CheckCircle2, "bg-emerald-100 text-emerald-700"), nota: "Horario de guardia: sin revisión de QA" };
    case "cierre":
      return estado("Ticket cerrado", Lock, "bg-slate-200 text-slate-700");
    case "cancelacion":
      return estado("Ticket cancelado", XCircle, "bg-rose-100 text-rose-700");
    case "reapertura":
      return estado("Ticket reabierto", RotateCcw, "bg-amber-100 text-amber-700");
    case "subtarea_creada":
      return { icono: ListChecks, tono: "bg-violet-100 text-violet-700", grupo: "qa", titulo: `${e.nuevo ?? "Subtarea"} abierta para QA` };
    case "subtarea_estado":
      return {
        icono: ListChecks,
        tono: "bg-violet-100 text-violet-700",
        grupo: "qa",
        titulo: String(e.metadata?.titulo ?? "Subtarea"),
        cambio: { antes: e.anterior, despues: e.nuevo, colores: true },
        nota: e.metadata?.reentrega ? "Vuelve a revisión tras la corrección" : null,
      };
    case "cambio_responsable":
      return {
        icono: UserRound,
        tono: "bg-sky-100 text-sky-700",
        grupo: "asignacion",
        titulo: e.nuevo ? `Asignado a ${e.nuevo}` : "Quedó sin responsable",
        cambio: e.anterior ? { antes: e.anterior, despues: e.nuevo ?? "Sin asignar" } : undefined,
      };
    case "cambio_prioridad":
      return { icono: Flag, tono: "bg-amber-100 text-amber-700", grupo: "otros", titulo: "Cambió la prioridad", cambio: { antes: e.anterior, despues: e.nuevo } };
    case "cambio_clasificacion":
      return { icono: Tag, tono: "bg-indigo-100 text-indigo-700", grupo: "otros", titulo: "Cambió la clasificación", cambio: { antes: e.anterior, despues: e.nuevo } };
    case "cambio_tipo":
      return { icono: Tag, tono: "bg-indigo-100 text-indigo-700", grupo: "otros", titulo: "Cambió el tipo", cambio: { antes: e.anterior, despues: e.nuevo } };
    case "cambio_sla":
      return { icono: Clock, tono: "bg-indigo-100 text-indigo-700", grupo: "otros", titulo: "SLA recalculado", cambio: { antes: e.anterior, despues: e.nuevo } };
    case "cambio_fecha_objetivo":
      return { icono: CalendarClock, tono: "bg-slate-100 text-slate-600", grupo: "otros", titulo: "Cambió la fecha de entrega", cambio: { antes: e.anterior, despues: e.nuevo } };
    case "cambio_proxima_accion":
      return { icono: Pencil, tono: "bg-slate-100 text-slate-600", grupo: "otros", titulo: "Próxima acción actualizada", nota: e.nuevo };
    case "edicion": {
      const campos = (e.metadata?.campos as string[] | undefined) ?? [];
      return {
        icono: Pencil,
        tono: "bg-slate-100 text-slate-600",
        grupo: "otros",
        titulo: "Ticket editado",
        nota: campos.length ? `Cambió: ${campos.map((c) => CAMPOS_LEGIBLES[c] ?? c).join(", ")}` : null,
      };
    }
    case "comentario":
      return e.metadata?.rechazo_qa
        ? { icono: MessageSquare, tono: "bg-rose-100 text-rose-700", grupo: "qa", titulo: "Observación de QA" }
        : { icono: MessageSquare, tono: "bg-slate-100 text-slate-600", grupo: "comentarios", titulo: e.metadata?.subtarea_id ? "Comentó en la revisión" : "Comentó" };
    case "archivo_agregado":
      return { icono: FilePlus2, tono: "bg-slate-100 text-slate-600", grupo: "otros", titulo: "Adjuntó un archivo", nota: e.nuevo };
    case "archivo_eliminado":
      return { icono: FileX2, tono: "bg-rose-100 text-rose-700", grupo: "otros", titulo: "Eliminó un archivo", nota: e.anterior };
    case "relacion_agregada":
      return { icono: Link2, tono: "bg-slate-100 text-slate-600", grupo: "otros", titulo: `Vinculado con ${e.nuevo ?? "otro ticket"}` };
    case "relacion_eliminada":
      return { icono: Link2, tono: "bg-slate-100 text-slate-600", grupo: "otros", titulo: `Se quitó el vínculo con ${e.anterior ?? "otro ticket"}` };
    default:
      return { icono: Clock, tono: "bg-slate-100 text-slate-600", grupo: "otros", titulo: e.tipo_evento };
  }
}

const PY = "Etc/GMT+3";
const diaClave = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: PY }).format(new Date(iso));
const hora = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: PY, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

function tituloDia(clave: string, hoy: string, ayer: string): string {
  if (clave === hoy) return "Hoy";
  if (clave === ayer) return "Ayer";
  const [a, m, d] = clave.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d, 12));
  const txt = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(fecha);
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/**
 * Historial: la auditoría del ticket, lo más nuevo arriba y agrupado por día.
 *
 * Nada de lo que se ve acá se puede editar ni borrar —la base no lo permite—,
 * así que es la fuente confiable de qué pasó, cuándo y quién lo hizo.
 */
export default function TicketHistorialPage() {
  const { ticket, catalogos } = useTicket();
  const [eventos, setEventos] = useState<Evento[] | null>(() => historialEnMemoria<Evento[]>(ticket.id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Grupo | "todo">("todo");
  const [ahora] = useState(() => Date.now());

  // La primera vez sirve lo precargado; si el ticket cambia, va a la base.
  const primera = useRef(true);
  useEffect(() => {
    let vivo = true;
    obtenerHistorial<Evento[]>(ticket.id, !primera.current)
      .then((d) => vivo && setEventos(d))
      .catch((e: Error) => vivo && setError(e.message));
    primera.current = false;
    return () => {
      vivo = false;
    };
  }, [ticket.id, ticket.updated_at]);

  // Color de cada estado por su nombre (el historial ya viene traducido).
  const colorEstado = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of catalogos.estados) m.set(e.nombre, e.color);
    for (const e of ESTADOS_SUBTAREA) if (!m.has(e.nombre)) m.set(e.nombre, e.color);
    return m;
  }, [catalogos.estados]);

  const vistas = useMemo(() => (eventos ?? []).map((e) => ({ e, v: describir(e) })).reverse(), [eventos]);
  const cuenta = useMemo(() => {
    const c: Record<string, number> = { todo: vistas.length };
    for (const x of vistas) c[x.v.grupo] = (c[x.v.grupo] ?? 0) + 1;
    return c;
  }, [vistas]);
  const visibles = filtro === "todo" ? vistas : vistas.filter((x) => x.v.grupo === filtro);

  const hoy = diaClave(new Date(ahora).toISOString());
  const ayer = diaClave(new Date(ahora - 86_400_000).toISOString());
  const dias: { clave: string; items: typeof visibles }[] = [];
  for (const x of visibles) {
    const clave = diaClave(x.e.created_at);
    const ultimo = dias[dias.length - 1];
    if (ultimo?.clave === clave) ultimo.items.push(x);
    else dias.push({ clave, items: [x] });
  }

  const valor = (texto: string | null, colores?: boolean) => {
    if (!texto) return <span className="text-slate-400">—</span>;
    const color = colores ? colorEstado.get(texto) : undefined;
    return color ? <Insignia color={color} punto>{texto}</Insignia> : <span className="font-medium text-slate-700">{texto}</span>;
  };

  return (
    <Tarjeta padding="p-0">
      {eventos == null ? (
        <div className="p-5">{error ? <Aviso>{error}</Aviso> : <Cargando />}</div>
      ) : eventos.length === 0 ? (
        <div className="p-5">
          <Vacio icono={History} tono="indigo" titulo="Sin eventos registrados" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-5 py-3">
            {FILTROS.filter((f) => f.id === "todo" || cuenta[f.id]).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                  filtro === f.id ? "bg-[#4FAEB2] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f.etiqueta}
                <span className={`tabular-nums ${filtro === f.id ? "text-white/80" : "text-slate-400"}`}>{cuenta[f.id] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="px-5 pb-4">
            {dias.map((d) => (
              <section key={d.clave}>
                <h3 className="sticky top-0 z-10 -mx-5 bg-white/95 px-5 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-wider text-slate-400 backdrop-blur">
                  {tituloDia(d.clave, hoy, ayer)}
                </h3>
                <ol className="divide-y divide-slate-100">
                  {d.items.map(({ e, v }) => {
                    const Icono = v.icono;
                    return (
                      <li key={e.id} className="flex gap-3 py-2.5">
                        <span className="w-11 shrink-0 pt-1 text-right text-[12px] tabular-nums text-slate-400">{hora(e.created_at)}</span>
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${v.tono}`} aria-hidden>
                          <Icono className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-[13.5px] font-semibold text-slate-800">{v.titulo}</p>
                            {v.cambio ? (
                              <span className="inline-flex flex-wrap items-center gap-1.5 text-[12.5px]">
                                {v.cambio.antes != null ? (
                                  <>
                                    {valor(v.cambio.antes, v.cambio.colores)}
                                    <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden />
                                  </>
                                ) : null}
                                {valor(v.cambio.despues, v.cambio.colores)}
                              </span>
                            ) : null}
                          </div>
                          {v.nota ? <p className="mt-0.5 truncate text-[12.5px] text-slate-500">{v.nota}</p> : null}
                        </div>
                        <span className="hidden shrink-0 items-center gap-1.5 pt-0.5 text-[12px] text-slate-500 sm:inline-flex">
                          {e.usuario ? (
                            <>
                              <Avatar nombre={e.usuario.nombre} tam={20} />
                              {e.usuario.nombre}
                            </>
                          ) : (
                            <span className="italic text-slate-400">Sistema</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}
    </Tarjeta>
  );
}
