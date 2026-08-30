"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Selector de fecha propio, reemplazo directo de `<input type="date">`.
 *
 * POR QUÉ: el picker nativo lo dibuja el navegador. Abre SIEMPRE en el mes
 * actual y sólo se mueve de a un mes, así que cargar una fecha de nacimiento
 * de 1995 son ~370 clics en la flechita. Además cambia de aspecto entre
 * navegadores y el campo no acepta que escribas la fecha de corrido.
 *
 * Acá hay dos caminos, y el rápido es escribir:
 *  - Se puede tipear `30081995`, `30/08/1995` o `30-8-95`: se formatea solo.
 *  - El calendario tiene combo de MES y de AÑO, así que cualquier fecha está
 *    a dos clics, sin importar cuán lejos esté.
 *
 * CONTRATO: idéntico al input nativo. `value` y lo que se emite son
 * `YYYY-MM-DD`, y `onChange` recibe un evento con `target.name` y
 * `target.value`, así el reemplazo no obliga a tocar los formularios (mismo
 * recurso que ya usa `UsuarioForm.setField`).
 */

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS = ["LU", "MA", "MI", "JU", "VI", "SÁ", "DO"];

const PANEL_ANCHO = 296;
const PANEL_ALTO = 356;

const p2 = (n: number) => String(n).padStart(2, "0");

/**
 * Dónde plantar el panel para que quede SIEMPRE dentro de la ventana.
 *
 * Elegir lado no alcanza: cuando el campo está a media altura de un modal no
 * entra ni arriba ni abajo, y sin recortar contra la ventana el panel se
 * dibuja fuera de la pantalla — existe pero no se ve, y parece que el clic no
 * hizo nada. Misma corrección que en `FechaHoraSelect`.
 *
 * Pura y exportada para poder probar la geometría sin navegador.
 */
export function calcularPosFecha(
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
    top: Math.max(8, Math.min(propuesto, vp.height - alto - 8)),
    maxHeight: alto,
  };
}

/** "1995-08-30" → Date local, o null si no es una fecha válida. */
export function parseIso(v: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v ?? "").slice(0, 10));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Rechaza "2026-02-31": el Date rebalsa al mes siguiente.
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

const aIso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const aTexto = (v: string) => {
  const d = parseIso(v);
  return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : "";
};

/**
 * Interpreta lo tipeado. Acepta separadores `/ - .` o nada, y año de 2 o 4
 * dígitos. Con 2 dígitos usa la ventana 1930-2029, que es la que cubre fechas
 * de nacimiento y vencimientos sin ambigüedad práctica.
 */
export function parseTipeado(texto: string): string | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  // Los formatos compactos valen SOLO si no hay separadores: con ellos,
  // "3/8/1995" se aplana a "381995" y se leeria como dia 38.
  const soloDigitos = /^\d+$/.test(limpio);
  const n = limpio;
  let d: number, m: number, a: number;
  if (soloDigitos && /^\d{8}$/.test(n)) {
    d = +n.slice(0, 2); m = +n.slice(2, 4); a = +n.slice(4);
  } else if (soloDigitos && /^\d{6}$/.test(n)) {
    d = +n.slice(0, 2); m = +n.slice(2, 4); a = +n.slice(4);
    a = a >= 30 ? 1900 + a : 2000 + a;
  } else {
    const partes = limpio.split(/[^\d]+/).filter(Boolean);
    if (partes.length !== 3) return null;
    d = +partes[0]; m = +partes[1]; a = +partes[2];
    if (a < 100) a = a >= 30 ? 1900 + a : 2000 + a;
  }
  if (!d || !m || !a || m > 12 || d > 31 || a < 1900 || a > 2200) return null;
  const fecha = new Date(a, m - 1, d);
  if (fecha.getMonth() !== m - 1 || fecha.getDate() !== d) return null;
  return aIso(fecha);
}

/** Lunes a domingo, con relleno del mes anterior y el siguiente. */
function grillaDelMes(ancla: Date): Date[] {
  const primero = new Date(ancla.getFullYear(), ancla.getMonth(), 1);
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

export type FechaSelectProps = {
  /** Controlado. Si se omite, el componente se maneja solo (`defaultValue`). */
  value?: string;
  /** Recibe un evento con `target.name` / `target.value`, como el input nativo. */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** No controlado: valor inicial, como en el input nativo. */
  defaultValue?: string;
  name?: string;
  title?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  /** `YYYY-MM-DD`: los días fuera del rango quedan deshabilitados. */
  min?: string;
  max?: string;
  placeholder?: string;
  "aria-label"?: string;
  /** Primer año del combo. Por defecto 1930 (sirve para fechas de nacimiento). */
  anioDesde?: number;
  /** Último año del combo. Por defecto, el actual + 5. */
  anioHasta?: number;
};

export function FechaSelect({
  value,
  onChange,
  defaultValue,
  name = "",
  title,
  id,
  className = "",
  disabled = false,
  required = false,
  min,
  max,
  placeholder = "dd/mm/aaaa",
  anioDesde = 1930,
  anioHasta,
  ...rest
}: FechaSelectProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  /**
   * Controlado vs. no controlado, igual que el input nativo: si viene `value`
   * manda el padre; si no, el valor vive acá y `defaultValue` es el inicial.
   */
  const controlado = value !== undefined;
  const [interno, setInterno] = useState(() => defaultValue ?? "");
  const valorActual = controlado ? (value ?? "") : interno;
  const [texto, setTexto] = useState(() => aTexto(valorActual));

  const fecha = useMemo(() => parseIso(valorActual), [valorActual]);
  const [ancla, setAncla] = useState<Date>(() => fecha ?? new Date());

  // El texto lo maneja el usuario mientras escribe; se resincroniza cuando el
  // valor cambia desde afuera (carga del formulario, reset, atajo del panel).
  useEffect(() => {
    setTexto(aTexto(valorActual));
  }, [valorActual]);

  useEffect(() => {
    if (abierto) setAncla(fecha ?? new Date());
  }, [abierto, fecha]);

  useEffect(() => {
    if (!abierto) return;
    const recalcular = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPos(calcularPosFecha(r, { width: window.innerWidth, height: window.innerHeight }));
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
      if ((t as HTMLElement).closest?.("[data-fecha-panel]")) return;
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

  /**
   * Emite con la forma del input nativo. El evento se sintetiza porque el
   * componente no envuelve un `<input type="date">` real: es el mismo recurso
   * que ya usaba `UsuarioForm`, y evita tener que reescribir los ~70 formularios
   * que hoy hacen `onChange={(e) => setX(e.target.value)}`.
   */
  function emitir(valor: string) {
    if (!controlado) setInterno(valor);
    if (!onChange) return;
    onChange({
      target: { name, value: valor, type: "date" },
      currentTarget: { name, value: valor, type: "date" },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  }

  function alEscribir(v: string) {
    setTexto(v);
    if (!v.trim()) {
      emitir("");
      return;
    }
    const iso = parseTipeado(v);
    if (iso) {
      emitir(iso);
      setAncla(parseIso(iso) ?? new Date());
    }
  }

  /** Al salir del campo, lo tipeado se normaliza o se descarta. */
  function alSalir() {
    const iso = parseTipeado(texto);
    setTexto(iso ? aTexto(iso) : aTexto(valorActual));
  }

  const hoy = new Date();
  const dias = useMemo(() => grillaDelMes(ancla), [ancla]);
  const minD = useMemo(() => parseIso(min), [min]);
  const maxD = useMemo(() => parseIso(max), [max]);
  const fueraDeRango = (d: Date) =>
    (minD != null && d < new Date(minD.getFullYear(), minD.getMonth(), minD.getDate())) ||
    (maxD != null && d > new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate()));

  const anios = useMemo(() => {
    const hasta = anioHasta ?? new Date().getFullYear() + 5;
    const desde = Math.min(anioDesde, fecha?.getFullYear() ?? anioDesde);
    // Del más nuevo al más viejo: lo habitual está arriba y no hay que scrollear.
    return Array.from({ length: Math.max(1, hasta - desde + 1) }, (_, i) => hasta - i);
  }, [anioDesde, anioHasta, fecha]);

  function elegir(d: Date) {
    if (fueraDeRango(d)) return;
    emitir(aIso(d));
    setAbierto(false);
  }

  const panel =
    abierto && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            data-fecha-panel=""
            className="flex w-[296px] flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl"
            /*
              Cuelga de `body`, así que compite en el stacking context RAÍZ
              contra los modales (llegan a z-[110]). Por debajo, el panel se
              abre pero queda detrás del modal.
            */
            style={{ position: "fixed", left: pos.left, top: pos.top, maxHeight: pos.maxHeight, zIndex: 1000 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-2.5 py-2">
              <button
                type="button"
                aria-label="Mes anterior"
                onClick={() => setAncla(new Date(ancla.getFullYear(), ancla.getMonth() - 1, 1))}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Mes y año como combos: es lo que convierte "370 clics" en dos. */}
              <select
                aria-label="Mes"
                value={ancla.getMonth()}
                onChange={(e) => setAncla(new Date(ancla.getFullYear(), Number(e.target.value), 1))}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[12px] font-semibold capitalize text-slate-800 outline-none focus:border-[#4FAEB2]"
              >
                {MESES.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                aria-label="Año"
                value={ancla.getFullYear()}
                onChange={(e) => setAncla(new Date(Number(e.target.value), ancla.getMonth(), 1))}
                className="w-[74px] rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-[12px] font-semibold tabular-nums text-slate-800 outline-none focus:border-[#4FAEB2]"
              >
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              <button
                type="button"
                aria-label="Mes siguiente"
                onClick={() => setAncla(new Date(ancla.getFullYear(), ancla.getMonth() + 1, 1))}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            <div className="px-2.5 pb-2 pt-2">
              <div className="grid grid-cols-7 gap-0.5">
                {DIAS.map((d) => (
                  <span key={d} className="py-1 text-center text-[10px] font-semibold text-slate-400">
                    {d}
                  </span>
                ))}
                {dias.map((d, i) => {
                  const delMes = d.getMonth() === ancla.getMonth();
                  const elegido = fecha != null && mismoDia(d, fecha);
                  const esHoy = mismoDia(d, hoy);
                  const bloqueado = fueraDeRango(d);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={bloqueado}
                      onClick={() => elegir(d)}
                      className={`h-8 rounded-lg text-[12px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:text-slate-200 ${
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

            <div className="flex items-center gap-1 border-t border-slate-100 bg-slate-50/60 px-2.5 py-2">
              <button
                type="button"
                onClick={() => elegir(new Date())}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-[#2F6E71] transition-colors hover:bg-[#4FAEB2]/12"
              >
                Hoy
              </button>
              <span className="ml-auto text-[10px] text-slate-400">o escribí dd/mm/aaaa</span>
              <button
                type="button"
                onClick={() => {
                  emitir("");
                  setTexto("");
                  setAbierto(false);
                }}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-rose-600"
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
      {name ? <input type="hidden" name={name} value={valorActual} /> : null}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        aria-label={rest["aria-label"]}
        title={title}
        value={texto}
        onChange={(e) => alEscribir(e.target.value)}
        onBlur={alSalir}
        onFocus={() => setAbierto(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            alSalir();
            setAbierto(false);
          }
        }}
        className={className || "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-900 outline-none transition-colors focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:cursor-not-allowed disabled:opacity-60"}
        style={{ paddingRight: 34 }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Abrir calendario"
        onClick={() => setAbierto((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400 transition-colors hover:text-[#2F6E71] disabled:cursor-not-allowed"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
        </svg>
      </button>
      {panel}
    </div>
  );
}

export default FechaSelect;
