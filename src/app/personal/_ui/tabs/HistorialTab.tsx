"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck, CalendarClock, CircleDot, Clock, FileText } from "lucide-react";
import { apiPersonal, fechaCorta } from "../api";
import { Chip, SeccionCard } from "../compartido";
import type { EventoHistorial, TipoEventoHistorial } from "@/lib/personal/types";

const ICONO: Record<TipoEventoHistorial, typeof Clock> = {
  incidencia: AlertTriangle,
  asistencia: CalendarCheck,
  vacacion: CalendarClock,
  evaluacion: CircleDot,
  documento: FileText,
};

export default function HistorialTab({ id }: { id: string }) {
  const [eventos, setEventos] = useState<EventoHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setEventos((await apiPersonal<{ eventos: EventoHistorial[] }>(`/api/personal/${id}/historial`)).eventos); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar"); }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <SeccionCard icon={Clock} colorIcono="bg-slate-100 text-slate-600" titulo="Historial del funcionario" subtitulo="Línea de tiempo con incidencias, asistencia, vacaciones, desempeño y documentos.">
      {error ? <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</div> : null}

      <div className="mt-4">
        {eventos == null ? <p className="py-8 text-center text-[13px] text-slate-400">Cargando…</p> :
         eventos.length === 0 ? <p className="py-8 text-center text-[13px] text-slate-400">Sin movimientos todavía.</p> : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {eventos.map((ev) => {
              const Icon = ICONO[ev.tipo] ?? Clock;
              return (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[26px] flex h-6 w-6 items-center justify-center rounded-full bg-white ring-1 ring-slate-200">
                    <Icon className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-slate-800">{ev.titulo}</span>
                    {ev.chip ? <Chip className={ev.chip}>{fechaCorta(ev.fecha)}</Chip> : <span className="text-[12px] text-slate-400">{fechaCorta(ev.fecha)}</span>}
                  </div>
                  {ev.detalle ? <p className="mt-0.5 text-[13px] text-slate-500">{ev.detalle}</p> : null}
                  {ev.autor ? <p className="text-[11.5px] text-slate-400">por {ev.autor}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </SeccionCard>
  );
}
