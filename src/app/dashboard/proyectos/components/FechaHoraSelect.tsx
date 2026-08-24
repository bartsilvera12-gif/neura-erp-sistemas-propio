"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Selector de fecha y hora propio.
 *
 * Reemplaza al `<input type="datetime-local">` nativo, que lo dibuja el
 * navegador: es chico, cambia de aspecto entre Chrome/Firefox/Safari, la hora
 * queda escondida detrás de un spinner y no hay atajos para lo que se elige el
 * 90 % de las veces ("hoy a la tarde", "mañana").
 *
 * Trabaja siempre en hora LOCAL y emite el mismo formato que el input nativo
 * (`YYYY-MM-DDTHH:mm`), así quien lo usa no cambia nada más.
 */

const DIAS = ["LU", "MA", "MI", "JU", "VI", "SÁ", "DO"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Horas sugeridas: las que de verdad se usan para comprometer una entrega. */
const HORAS_RAPIDAS = ["09:00", "12:00", "15:00", "18:00"];

const p2 = (n: number) => String(n).padStart(2, "0");

/** Medidas del panel. `ALTO` es el alto máximo; si no entra, el panel scrollea. */
const PANEL_ANCHO = 292;
const PANEL_ALTO = 380;

/**
 * Dónde plantar el panel para que quede SIEMPRE dentro de la ventana.
 *
 * La versión anterior decidía "abajo salvo que entre arriba", y cuando no
 * entraba en ninguno de los dos —el caso normal de un campo a media altura
 * dentro de un modal— caía al caso "abajo" y lo dibujaba por debajo del borde
 * inferior: el panel existía pero no se veía, y parecía que el clic no hacía
 * nada. Ahora, además de elegir el lado, se recorta contra la ventana.
 *
 * Función pura y exportada para poder probar la geometría sin un navegador.
 */
export function calcularPos(
  r: { left: number; top: number; bottom: number },
  vp: { width: number; height: number }
): { left: number; top: number; maxHeight: number } {
  const espacioAbajo = vp.height - r.bottom - 8;
  const espacioArriba = r.top - 8;
  const abreArriba = espacioAbajo < PANEL_ALTO && espacioArriba > espacioAbajo;

  const alto = Math.min(PANEL_ALTO, Math.max(200, abreArriba ? espacioArriba : espacioAbajo));
  const propuesto = abreArriba ? r.top - alto - 4 : r.bottom + 4;

  return {
    left: Math.max(8, Math.min(r.left, vp.width - PANEL_ANCHO - 8)),
    // El recorte final es lo que garantiza que se vea, elija el lado que elija.
    top: Math.max(8, Math.min(propuesto, vp.height - alto - 8)),
    maxHeight: alto,
  };
}
const aValor = (d: Date, hhmm: string) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${hhmm}`;

function parseValor(valor: string): { fecha: Date | null; hora: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor);
  if (!m) return { fecha: null, hora: "12:00" };
  return {
    fecha: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    hora: `${m[4]}:${m[5]}`,
  };
}

/** Lunes a domingo, con los días de relleno del mes anterior y el siguiente. */
function grillaDelMes(ancla: Date): Date[] {
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
  // getDay(): 0 = domingo. Se corre para que la semana arranque el lunes.
  const desplazamiento = (primero.getDay() + 6) % 7;
  const inicio = new Date(primero);
  inicio.setDate(primero.getDate() - desplazamiento);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    return d;
  });
}

const mismoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function FechaHoraSelect({
  value,
  onChange,
  placeholder = "Elegí fecha y hora",
  disabled = false,
  ariaLabel,
}: {
  /** `YYYY-MM-DDTHH:mm` en hora local, o "" si no hay nada. */
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  const { fecha, hora } = useMemo(() => parseValor(value), [value]);
  const [mesAncla, setMesAncla] = useState<Date>(() => fecha ?? new Date());
  const [horaDraft, setHoraDraft] = useState(hora);

  // Al abrir, el calendario arranca en el mes de lo ya elegido (o en el actual)
  // y el reloj en la hora guardada.
  useEffect(() => {
    if (!abierto) return;
    setMesAncla(fecha ?? new Date());
    setHoraDraft(hora);
  }, [abierto, fecha, hora]);

  useEffect(() => {
    if (!abierto) return;
    const recalcular = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos(calcularPos(r, { width: window.innerWidth, height: window.innerHeight }));
    };
    recalcular();
    window.addEventListener("scroll", recalcular, true);
    window.addEventListener("resize", recalcular);
    return () => {
      window.removeEventListener("scroll", recalcular, true);
      window.removeEventListener("resize", recalcular);
    };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const alClickear = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-fechahora-panel]")) return;
      setAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", alClickear);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("mousedown", alClickear);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto]);

  const hoy = new Date();
  const dias = useMemo(() => grillaDelMes(mesAncla), [mesAncla]);

  function elegirDia(d: Date) {
    onChange(aValor(d, horaDraft || "12:00"));
  }
  function elegirHora(h: string) {
    setHoraDraft(h);
    // Si todavía no hay día, tocar una hora ya deja la cita en el día de hoy:
    // es lo que se espera, y evita tener que volver a tocar el calendario.
    onChange(aValor(fecha ?? new Date(), h));
  }
  function atajo(diasSuma: number) {
    const d = new Date();
    d.setDate(d.getDate() + diasSuma);
    onChange(aValor(d, horaDraft || "12:00"));
    setMesAncla(d);
  }

  const etiqueta = fecha
    ? `${p2(fecha.getDate())}/${p2(fecha.getMonth() + 1)}/${fecha.getFullYear()} · ${hora}`
    : "";

  const panel =
    abierto && pos
      ? createPortal(
          <div
            data-fechahora-panel=""
            className="flex w-[292px] flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl"
            /*
              El panel cuelga de `body` (portal), asi que compite en el stacking
              context RAIZ contra los modales, que llegan a z-[110]. Con un
              z-index menor el panel se abre pero queda DETRAS del modal: se ve
              girar el chevron y nada mas, o sea "el selector no despliega".
              Mismo valor que FancySelect, que ya habia pasado por esto.
            */
            style={{ position: "fixed", left: pos.left, top: pos.top, maxHeight: pos.maxHeight, zIndex: 1000 }}
            // Sin frenar la propagacion, el "click afuera" del modal que lo
            // contiene se dispara al elegir y cierra todo.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => setMesAncla(new Date(mesAncla.getFullYear(), mesAncla.getMonth() - 1, 1))}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Mes anterior"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <span className="text-[13px] font-semibold capitalize text-slate-800">
                {MESES[mesAncla.getMonth()]} {mesAncla.getFullYear()}
              </span>
              <button
                type="button"
                onClick={() => setMesAncla(new Date(mesAncla.getFullYear(), mesAncla.getMonth() + 1, 1))}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Mes siguiente"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <div className="px-3 pb-2 pt-2">
              <div className="grid grid-cols-7 gap-0.5">
                {DIAS.map((d) => (
                  <span key={d} className="py-1 text-center text-[10px] font-semibold text-slate-400">
                    {d}
                  </span>
                ))}
                {dias.map((d, i) => {
                  const delMes = d.getMonth() === mesAncla.getMonth();
                  const elegido = fecha != null && mismoDia(d, fecha);
                  const esHoy = mismoDia(d, hoy);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => elegirDia(d)}
                      className={`h-8 rounded-lg text-[12px] tabular-nums transition-colors ${
                        elegido
                          ? "bg-[#2F6E71] font-semibold text-white"
                          : delMes
                            ? "text-slate-700 hover:bg-[#4FAEB2]/12"
                            : "text-slate-300 hover:bg-slate-50"
                      } ${esHoy && !elegido ? "ring-1 ring-inset ring-[#4FAEB2]" : ""}`}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-100 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hora</span>
                <input
                  type="time"
                  value={horaDraft}
                  onChange={(e) => elegirHora(e.target.value || "12:00")}
                  className="ml-auto w-[104px] rounded-lg border border-slate-200 px-2 py-1 text-[13px] tabular-nums text-slate-800 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/25"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {HORAS_RAPIDAS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => elegirHora(h)}
                    className={`rounded-md px-2 py-1 text-[11px] tabular-nums transition-colors ${
                      horaDraft === h
                        ? "bg-[#4FAEB2]/15 font-semibold text-[#2F6E71]"
                        : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
              <button
                type="button"
                onClick={() => atajo(0)}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-[#2F6E71] transition-colors hover:bg-[#4FAEB2]/12"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => atajo(1)}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-[#2F6E71] transition-colors hover:bg-[#4FAEB2]/12"
              >
                Mañana
              </button>
              <button
                type="button"
                onClick={() => atajo(7)}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-[#2F6E71] transition-colors hover:bg-[#4FAEB2]/12"
              >
                En 1 semana
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setAbierto(false);
                }}
                className="ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-rose-600"
              >
                Borrar
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span aria-hidden="true" className="shrink-0 text-slate-400">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
          </svg>
        </span>
        <span className={`min-w-0 flex-1 truncate tabular-nums ${etiqueta ? "text-slate-900" : "text-slate-400"}`}>
          {etiqueta || placeholder}
        </span>
        <span aria-hidden="true" className={`shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {panel}
    </div>
  );
}
