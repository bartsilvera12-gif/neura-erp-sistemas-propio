"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { clienteConfig } from "@/erp2/cliente.config";
import { HojaInferior } from "@/erp2/components/HojaInferior";
import { hoyPY, TZ_PY } from "@/erp2/lib/fecha/paraguay";
import { useEsMovil } from "@/erp2/lib/ui/responsive";

const BRAND = clienteConfig.color;

/**
 * Selector de fecha (y fecha + hora) propio, gemelo visual de `Select`: nunca el
 * input de fecha nativo del navegador. Calendario mensual en español (lunes primero), "Hoy" y
 * "Limpiar", días fuera de `min`/`max` deshabilitados, hoy marcado y el elegido con el
 * color de marca. El valor es el MISMO string que el input nativo:
 *   · `YYYY-MM-DD` (fecha) · `YYYY-MM-DDTHH:mm` (con `conHora`, minutos en pasos de `pasoMin`).
 * En el disparador se ve `dd/mm/aaaa` (y `HH:mm`).
 * Escritorio/tablet: popover portaleado en <body> (fixed, se abre hacia arriba si abajo no
 * entra) marcado como `data-capa-modal`, así Escape cierra SOLO el calendario aunque esté
 * dentro de un modal. Celular (< 640 px): hoja inferior con objetivos de 44 px.
 * Teclado: ↓ en el botón abre · flechas mueven el día · Re Pág/Av Pág cambian de mes
 * (Shift: de año) · Inicio/Fin: lunes/domingo · Enter elige · Esc cierra.
 */

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_CORTOS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

const RE_FECHA = /^\d{4}-\d{2}-\d{2}/;
const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" → partes (mes 1-12). */
function partes(iso: string) {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}
const aIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** suma días con aritmética UTC (sin saltos de horario de verano). */
function sumarDias(iso: string, n: number) {
  const { y, m, d } = partes(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return aIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
/** suma meses conservando el día (recortado al último del mes). */
function sumarMeses(iso: string, n: number) {
  const { y, m, d } = partes(iso);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const yy = base.getUTCFullYear();
  const mm = base.getUTCMonth() + 1;
  const ultimo = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return aIso(yy, mm, Math.min(d, ultimo));
}
/** 0 = lunes … 6 = domingo */
function diaSemana(iso: string) {
  const { y, m, d } = partes(iso);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
function etiquetaDia(iso: string) {
  const { y, m, d } = partes(iso);
  return `${DIAS_LARGOS[diaSemana(iso)]} ${d} de ${MESES[m - 1].toLowerCase()} de ${y}`;
}
/** hora actual de Paraguay redondeada hacia arriba al paso ("HH:mm"). */
function horaAhoraPY(paso: number) {
  const [h, m] = new Date().toLocaleTimeString("en-GB", { timeZone: TZ_PY, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":").map(Number);
  let total = Math.ceil(((h % 24) * 60 + m) / paso) * paso;
  if (total >= 24 * 60) total = 24 * 60 - paso;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function SelectorFecha({
  value,
  onChange,
  conHora = false,
  min,
  max,
  pasoMin = 15,
  horaPorDefecto = "09:00",
  etiqueta,
  placeholder,
  block = false,
  compacto = false,
  disabled = false,
  className = "",
  claseBoton,
  alerta = false,
  id,
}: {
  /** `YYYY-MM-DD` o, con `conHora`, `YYYY-MM-DDTHH:mm`; "" = vacío */
  value: string;
  onChange: (v: string) => void;
  /** fecha + hora (como `datetime-local`) */
  conHora?: boolean;
  /** límites (inclusive) en formato ISO; con hora se compara sólo la fecha */
  min?: string;
  max?: string;
  /** paso de los minutos (por defecto 15) */
  pasoMin?: number;
  /** hora que se usa al elegir un día cuando todavía no hay hora */
  horaPorDefecto?: string;
  /** título de la hoja inferior en celular y aria-label del botón */
  etiqueta?: string;
  placeholder?: string;
  /** ocupa todo el ancho (campos de formulario) */
  block?: boolean;
  /** mismo tamaño que un input compacto (como `Select compacto`) */
  compacto?: boolean;
  disabled?: boolean;
  className?: string;
  /** reemplaza forma/tamaño/tipografía del disparador (p. ej. "h-10 rounded-xl px-3 text-slate-800")
   *  para igualar la altura de los demás campos; borde, foco y estados se mantienen */
  claseBoton?: string;
  /** borde ámbar (campo que falta completar) */
  alerta?: boolean;
  id?: string;
}) {
  const esMovil = useEsMovil();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);

  const fecha = RE_FECHA.test(value) ? value.slice(0, 10) : "";
  const hora = conHora && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(11, 16) : "";
  const minF = min && RE_FECHA.test(min) ? min.slice(0, 10) : "";
  const maxF = max && RE_FECHA.test(max) ? max.slice(0, 10) : "";
  const hoy = hoyPY();
  const fueraDeRango = useCallback((iso: string) => (!!minF && iso < minF) || (!!maxF && iso > maxF), [minF, maxF]);
  const acotar = useCallback((iso: string) => (minF && iso < minF ? minF : maxF && iso > maxF ? maxF : iso), [minF, maxF]);

  // Día con foco (teclado) y mes a la vista: el mes sigue siempre al foco.
  const [foco, setFoco] = useState(() => fecha || hoy);
  const mesVista = foco.slice(0, 7);

  const ancho = conHora && !esMovil ? 436 : 300;

  function abrir() {
    setFoco(acotar(fecha || hoy));
    setOpen(true);
  }
  const cerrar = useCallback((devolverFoco = true) => {
    setOpen(false);
    if (devolverFoco) window.setTimeout(() => boton.current?.focus(), 0);
  }, []);

  // Click afuera (escritorio; en celular cierra el fondo de la hoja).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Escape en escritorio: el popover es una capa (data-capa-modal) y cierra sólo si es la de arriba.
  useEffect(() => {
    if (!open || esMovil) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const capas = document.querySelectorAll("[data-capa-modal]");
      if (capas.length && capas[capas.length - 1] !== panel.current) return;
      e.preventDefault();
      cerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, esMovil, cerrar]);

  // Posición pegada al botón (como Select), recortada para no salirse por la derecha.
  const ubicar = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const margen = 8;
    const alto = 372;
    const abajo = window.innerHeight - r.bottom - margen;
    const arriba = r.top - margen;
    const left = Math.max(margen, Math.min(r.left, window.innerWidth - ancho - margen));
    if (abajo >= alto || abajo >= arriba) setPos({ left, top: r.bottom + 6, maxH: Math.max(160, abajo - 6) });
    else setPos({ left, bottom: window.innerHeight - r.top + 6, maxH: Math.max(160, arriba - 6) });
  }, [ancho]);
  useLayoutEffect(() => {
    if (!open || esMovil) return;
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => {
      window.removeEventListener("resize", ubicar);
      window.removeEventListener("scroll", ubicar, true);
    };
  }, [open, ubicar, esMovil]);

  // Al abrir: foco en el día y hora/minuto elegidos a la vista.
  useEffect(() => {
    if (!open || (!pos && !esMovil)) return;
    const t = window.setTimeout(() => {
      panel.current?.querySelector<HTMLElement>(`[data-dia="${foco}"]`)?.focus({ preventScroll: true });
      panel.current?.querySelectorAll<HTMLElement>('[data-lista-hora] [aria-pressed="true"]').forEach((el) => el.scrollIntoView({ block: "center" }));
    }, esMovil ? 40 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos != null, esMovil]);

  // El foco del teclado sigue al día resaltado.
  const moverFoco = (iso: string) => {
    const nuevo = acotar(iso);
    setFoco(nuevo);
    window.setTimeout(() => panel.current?.querySelector<HTMLElement>(`[data-dia="${nuevo}"]`)?.focus({ preventScroll: true }), 0);
  };

  function emitir(f: string, h: string) {
    onChange(conHora ? `${f}T${h || horaPorDefecto}` : f);
  }
  function elegirDia(iso: string) {
    if (fueraDeRango(iso)) return;
    setFoco(iso);
    emitir(iso, hora);
    if (!conHora) cerrar();
  }
  function elegirHora(h: string, mm: string) {
    const f = fecha || acotar(foco);
    onChange(`${f}T${h}:${mm}`);
  }
  function irHoy() {
    const f = acotar(hoy);
    setFoco(f);
    if (conHora) emitir(f, hora || horaAhoraPY(pasoMin));
    else { emitir(f, ""); cerrar(); }
  }
  function limpiar() {
    onChange("");
    cerrar();
  }

  function onGridKey(e: React.KeyboardEvent) {
    const salto: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in salto) { e.preventDefault(); moverFoco(sumarDias(foco, salto[e.key])); }
    else if (e.key === "PageUp" || e.key === "PageDown") { e.preventDefault(); moverFoco(sumarMeses(foco, (e.key === "PageUp" ? -1 : 1) * (e.shiftKey ? 12 : 1))); }
    else if (e.key === "Home") { e.preventDefault(); moverFoco(sumarDias(foco, -diaSemana(foco))); }
    else if (e.key === "End") { e.preventDefault(); moverFoco(sumarDias(foco, 6 - diaSemana(foco))); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegirDia(foco); }
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) { e.preventDefault(); abrir(); }
  }

  // ── Calendario ──────────────────────────────────────────────────────────────
  const { y: vy, m: vm } = partes(`${mesVista}-01`);
  const primero = `${mesVista}-01`;
  const inicioGrilla = sumarDias(primero, -diaSemana(primero));
  const diasMes = new Date(Date.UTC(vy, vm, 0)).getUTCDate();
  const semanas = Math.ceil((diaSemana(primero) + diasMes) / 7);
  const celdas = Array.from({ length: semanas * 7 }, (_, i) => sumarDias(inicioGrilla, i));
  const ultimoMesAnterior = sumarDias(primero, -1);
  const primeroMesSiguiente = aIso(vm === 12 ? vy + 1 : vy, vm === 12 ? 1 : vm + 1, 1);
  const sinAnterior = !!minF && ultimoMesAnterior < minF;
  const sinSiguiente = !!maxF && primeroMesSiguiente > maxF;
  const celda = esMovil ? "h-11 text-[15px]" : "h-9 text-[13px]";

  const calendario = (
    <div className={esMovil ? "w-full" : "w-[284px] shrink-0"}>
      <div className="mb-1 flex items-center justify-between gap-1">
        <button type="button" aria-label="Mes anterior" disabled={sinAnterior} onClick={() => moverFoco(sumarMeses(foco, -1))}
          className={`inline-flex ${esMovil ? "h-11 w-11" : "h-8 w-8"} items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent`}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div aria-live="polite" className="text-sm font-semibold text-slate-800">{MESES[vm - 1]} {vy}</div>
        <button type="button" aria-label="Mes siguiente" disabled={sinSiguiente} onClick={() => moverFoco(sumarMeses(foco, 1))}
          className={`inline-flex ${esMovil ? "h-11 w-11" : "h-8 w-8"} items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent`}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div role="grid" aria-label={`${MESES[vm - 1]} ${vy}`} onKeyDown={onGridKey}>
        <div role="row" className="grid grid-cols-7">
          {DIAS_CORTOS.map((d, i) => (
            <div key={d + i} role="columnheader" aria-label={DIAS_LARGOS[i]} className="flex h-7 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{d}</div>
          ))}
        </div>
        {Array.from({ length: semanas }, (_, s) => (
          <div key={s} role="row" className="grid grid-cols-7 gap-y-0.5">
            {celdas.slice(s * 7, s * 7 + 7).map((iso) => {
              const delMes = iso.slice(0, 7) === mesVista;
              const sel = iso === fecha;
              const esHoy = iso === hoy;
              const fuera = fueraDeRango(iso);
              const conFoco = iso === foco;
              return (
                <div key={iso} role="gridcell" aria-selected={sel} className="flex justify-center">
                  <button
                    type="button"
                    data-dia={iso}
                    tabIndex={conFoco ? 0 : -1}
                    disabled={fuera}
                    aria-label={etiquetaDia(iso) + (esHoy ? " (hoy)" : "")}
                    aria-current={esHoy ? "date" : undefined}
                    aria-pressed={sel}
                    onClick={() => elegirDia(iso)}
                    onFocus={() => { if (!conFoco) setFoco(iso); }}
                    className={`relative flex w-full items-center justify-center rounded-lg ${celda} tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-slate-300 disabled:line-through disabled:decoration-slate-300 ${
                      sel ? "font-semibold text-white" : delMes ? "text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-50"
                    } ${esHoy && !sel ? "font-semibold" : ""}`}
                    style={sel ? { backgroundColor: BRAND } : esHoy ? { color: BRAND, boxShadow: "inset 0 0 0 1px var(--brand-100)" } : undefined}
                  >
                    {Number(iso.slice(8, 10))}
                    {esHoy && !sel ? <span aria-hidden className="absolute bottom-1 h-1 w-1 rounded-full" style={{ backgroundColor: BRAND }} /> : null}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Hora ────────────────────────────────────────────────────────────────────
  const [hh, mmSel] = hora ? hora.split(":") : ["", ""];
  const minutos = Array.from({ length: Math.ceil(60 / pasoMin) }, (_, i) => pad(i * pasoMin));
  if (mmSel && !minutos.includes(mmSel)) { minutos.push(mmSel); minutos.sort(); }
  const hDef = horaPorDefecto.slice(0, 2);
  const mDef = horaPorDefecto.slice(3, 5);

  const chip = (activo: boolean) =>
    `flex items-center justify-center rounded-lg tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${activo ? "font-semibold text-white" : "text-slate-700 hover:bg-slate-100"}`;

  const selectorHora = !conHora ? null : esMovil ? (
    <div className="mt-3 border-t border-slate-100 pt-3" data-lista-hora="">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Hora</div>
      <div role="group" aria-label="Hora" className="grid grid-cols-6 gap-1">
        {HORAS.map((h) => {
          const a = h === hh;
          return (
            <button key={h} type="button" aria-pressed={a} aria-label={`${h} horas`} onClick={() => elegirHora(h, mmSel || mDef)}
              className={`${chip(a)} h-11 text-[15px] active:bg-slate-100`} style={a ? { backgroundColor: BRAND } : undefined}>{h}</button>
          );
        })}
      </div>
      <div className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Minutos</div>
      <div role="group" aria-label="Minutos" className="grid grid-cols-4 gap-1">
        {minutos.map((m) => {
          const a = m === mmSel;
          return (
            <button key={m} type="button" aria-pressed={a} aria-label={`${m} minutos`} onClick={() => elegirHora(hh || hDef, m)}
              className={`${chip(a)} h-11 text-[15px] active:bg-slate-100`} style={a ? { backgroundColor: BRAND } : undefined}>:{m}</button>
          );
        })}
      </div>
    </div>
  ) : (
    <div className="flex min-h-0 gap-1 border-l border-slate-100 pl-2" data-lista-hora="">
      {([["Hora", HORAS, hh, (v: string) => elegirHora(v, mmSel || mDef), (v: string) => v], ["Min", minutos, mmSel, (v: string) => elegirHora(hh || hDef, v), (v: string) => `:${v}`]] as const).map(
        ([titulo, lista, actual, elegir, texto]) => (
          <div key={titulo} className="flex w-[52px] flex-col">
            <div className="flex h-8 shrink-0 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{titulo}</div>
            <div role="group" aria-label={titulo === "Min" ? "Minutos" : "Hora"} className="h-[258px] space-y-0.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin]">
              {lista.map((v) => {
                const a = v === actual;
                return (
                  <button key={v} type="button" aria-pressed={a} onClick={() => elegir(v)}
                    className={`${chip(a)} h-8 w-full text-[13px]`} style={a ? { backgroundColor: BRAND } : undefined}>{texto(v)}</button>
                );
              })}
            </div>
          </div>
        ),
      )}
    </div>
  );

  const botonesPie = (
    <>
      <button type="button" onClick={limpiar}
        className={`rounded-lg px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 ${esMovil ? "min-h-11" : "h-8"}`}>Limpiar</button>
      <div className="ml-auto flex items-center gap-1.5">
        <button type="button" onClick={irHoy} disabled={fueraDeRango(hoy)}
          className={`rounded-lg px-3 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:cursor-not-allowed disabled:opacity-40 ${esMovil ? "min-h-11" : "h-8"}`} style={{ color: BRAND }}>
          {conHora ? "Ahora" : "Hoy"}
        </button>
        {conHora ? (
          <button type="button" onClick={() => cerrar()}
            className={`rounded-lg px-4 text-sm font-semibold text-white transition hover:opacity-90 ${esMovil ? "min-h-11" : "h-8"}`} style={{ backgroundColor: BRAND }}>Listo</button>
        ) : null}
      </div>
    </>
  );

  // ── Disparador ──────────────────────────────────────────────────────────────
  const texto = fecha ? `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}${conHora && hora ? ` ${hora}` : ""}` : "";
  const ph = placeholder ?? (conHora ? "dd/mm/aaaa --:--" : "dd/mm/aaaa");

  return (
    <div ref={ref} className={`relative ${block ? "w-full" : ""} ${className}`}>
      <button
        ref={boton}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : abrir())}
        onKeyDown={onTriggerKey}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={etiqueta ? `${etiqueta}${texto ? `: ${texto}` : ""}` : undefined}
        className={`flex w-full items-center justify-between gap-2 border bg-white text-left text-sm outline-none max-sm:min-h-11 ${claseBoton ?? (compacto ? "rounded-lg px-3 py-2 text-slate-800" : "rounded-xl py-2.5 pl-3.5 pr-3 font-medium text-slate-600")} transition hover:border-slate-300 focus:border-[var(--brand)] focus:shadow-[0_0_0_4px_var(--brand-100)] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200`}
        style={{ borderColor: open ? BRAND : alerta ? "#fcd34d" : "#e2e8f0", boxShadow: open ? `0 0 0 4px var(--brand-100)` : undefined }}
      >
        <span className={`truncate tabular-nums ${texto ? "" : "font-normal text-slate-400"}`}>{texto || ph}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>

      {open && !disabled && esMovil ? (
        <HojaInferior
          titulo={etiqueta ?? (conHora ? "Elegí fecha y hora" : "Elegí una fecha")}
          onClose={() => cerrar()}
          z="z-[200]"
          panelRef={panel}
          pie={botonesPie}
        >
          {calendario}
          {selectorHora}
        </HojaInferior>
      ) : null}

      {open && !disabled && !esMovil && pos && typeof document !== "undefined" ? createPortal(
        <div
          ref={panel}
          data-capa-modal=""
          role="dialog"
          aria-label={etiqueta ?? (conHora ? "Elegir fecha y hora" : "Elegir fecha")}
          className="fixed z-[200] flex flex-col overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-slate-200 bg-white p-2 shadow-[0_12px_32px_-8px_rgba(2,48,71,0.25)]"
          style={{
            left: pos.left, width: ancho, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH,
            transformOrigin: pos.top != null ? "top" : "bottom", animation: "rb-pop 0.15s cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div className="flex gap-2">
            {calendario}
            {selectorHora}
          </div>
          <div className="mt-2 flex items-center border-t border-slate-100 pt-2">{botonesPie}</div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

/** Atajo: `SelectorFecha` con hora (valor `YYYY-MM-DDTHH:mm`, como `datetime-local`). */
export function SelectorFechaHora(props: Omit<Parameters<typeof SelectorFecha>[0], "conHora">) {
  return <SelectorFecha {...props} conHora />;
}
