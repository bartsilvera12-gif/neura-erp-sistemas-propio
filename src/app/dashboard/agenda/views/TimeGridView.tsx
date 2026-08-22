"use client";

import { useEffect, useRef } from "react";
import type { AgendaCitaEnriquecida } from "@/lib/agenda/types";
import {
  ALTO_DOS_LINEAS_PX,
  DAY_START_SCROLL_HOUR,
  HOUR_PX,
  addDays,
  estadoStyle,
  hhmm,
  isToday,
  layoutDayEvents,
  pad,
  sameDay,
  startOfDay,
  startOfWeek,
  WEEKDAYS_ES,
} from "../calendar-utils";

const GUTTER_W = 56; // px (w-14)

export default function TimeGridView({
  view,
  anchor,
  citas,
  startHour,
  endHour,
  onSelect,
  onCreateAt,
}: {
  view: "dia" | "semana";
  anchor: Date;
  citas: AgendaCitaEnriquecida[];
  startHour: number;
  endHour: number;
  onSelect: (c: AgendaCitaEnriquecida) => void;
  onCreateAt: (d: Date) => void;
}) {
  const days = view === "dia" ? [startOfDay(anchor)] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const hours = Array.from({ length: Math.max(1, endHour - startHour) }, (_, i) => startHour + i);
  const gridHeight = hours.length * HOUR_PX;

  // Con el día completo visible, al abrir posicionamos la grilla cerca de la
  // mañana (sin perder la madrugada, que queda accesible scrolleando hacia arriba).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (DAY_START_SCROLL_HOUR - startHour) * HOUR_PX);
  }, [view, startHour, endHour]);

  function handleColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMin = startHour * 60 + (y / HOUR_PX) * 60;
    const minutes = Math.max(startHour * 60, Math.min(endHour * 60 - 15, Math.round(rawMin / 15) * 15));
    const d = new Date(day);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    onCreateAt(d);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300/80 bg-white shadow-sm ring-1 ring-slate-100">
      {/* Header + grilla comparten el MISMO contenedor de scroll para que el
          ancho de la barra de scroll afecte por igual a encabezado y cuerpo y
          las divisiones de columnas queden alineadas. El header es sticky. */}
      <div ref={scrollRef} className="relative max-h-[68vh] overflow-y-auto">
        {/* Encabezado de días (sticky) */}
        <div className="sticky top-0 z-30 flex border-b border-slate-300/80 bg-slate-50">
          <div className="shrink-0 border-r border-slate-200" style={{ width: GUTTER_W }} />
          {days.map((d) => {
            const today = isToday(d);
            return (
              <div
                key={d.toISOString()}
                className={`flex-1 border-l border-slate-200 px-2 py-2 text-center ${today ? "bg-teal-50/70" : ""}`}
              >
                <div className={`text-[11px] font-medium uppercase tracking-wide ${today ? "text-teal-600" : "text-slate-400"}`}>
                  {WEEKDAYS_ES[(d.getDay() + 6) % 7]}
                </div>
                <div className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${today ? "bg-teal-500 text-white shadow-sm" : "text-slate-700"}`}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Cuerpo de la grilla */}
        <div className="flex" style={{ height: gridHeight }}>
          {/* Gutter de horas */}
          <div className="shrink-0 border-r border-slate-200 bg-slate-50/40" style={{ width: GUTTER_W }}>
            {hours.map((h, i) => (
              <div key={h} className="relative border-t border-slate-200" style={{ height: HOUR_PX }}>
                <span
                  className={`absolute right-1.5 ${i === 0 ? "top-0.5" : "-top-2"} text-[10px] font-medium text-slate-500`}
                >
                  {`${pad(h)}:00`}
                </span>
              </div>
            ))}
          </div>

          {/* Columnas por día */}
          {days.map((day) => {
            const dayStart = startOfDay(day);
            const dayCitas = citas.filter((c) => sameDay(new Date(c.inicio_at), day));
            const positioned = layoutDayEvents(dayCitas, dayStart, startHour, endHour);
            const today = isToday(day);
            return (
              <div
                key={day.toISOString()}
                onClick={(e) => handleColumnClick(day, e)}
                className={`relative flex-1 cursor-pointer border-l border-slate-200 transition-colors hover:bg-teal-50/20 ${today ? "bg-teal-50/40" : ""}`}
              >
                {/* líneas horarias (alineadas con el gutter) + media hora */}
                {hours.map((h) => (
                  <div key={h} className="relative border-t border-slate-200" style={{ height: HOUR_PX }}>
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-slate-100" />
                  </div>
                ))}
                {/* eventos */}
                {positioned.map((p) => {
                  const st = estadoStyle(p.cita.estado);
                  const ini = new Date(p.cita.inicio_at);
                  const fin = new Date(p.cita.fin_at);
                  const persona = p.cita.cliente?.nombre ?? p.cita.contacto_nombre;
                  // Con poco alto, título y horario van en UNA línea. Apilarlos
                  // igual dejaba la segunda cortada al medio contra el
                  // overflow-hidden, que es lo que se veía en las de 30 min.
                  const dosLineas = p.heightPx >= ALTO_DOS_LINEAS_PX;
                  const rango = `${hhmm(ini)}–${hhmm(fin)}`;
                  return (
                    <button
                      key={p.cita.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(p.cita);
                      }}
                      style={{
                        top: p.topPx,
                        height: p.heightPx,
                        left: `calc(${p.leftPct}% + 2px)`,
                        width: `calc(${p.widthPct}% - 4px)`,
                      }}
                      title={`${rango} · ${p.cita.titulo}${persona ? ` · ${persona}` : ""}`}
                      className={`absolute z-10 flex flex-col justify-center overflow-hidden rounded-lg border border-l-[3px] px-2 text-left text-[11px] leading-tight shadow-sm transition-all hover:z-20 hover:shadow-md hover:ring-1 hover:ring-black/5 ${
                        dosLineas ? "py-1" : "py-0.5"
                      } ${st.block}`}
                    >
                      {dosLineas ? (
                        <>
                          <span className="truncate font-semibold">{p.cita.titulo}</span>
                          <span className="truncate tabular-nums opacity-75">
                            {rango}
                            {persona ? ` · ${persona}` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="flex items-baseline gap-1.5 truncate">
                          <span className="shrink-0 text-[10px] tabular-nums opacity-70">{hhmm(ini)}</span>
                          <span className="truncate font-semibold">{p.cita.titulo}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
