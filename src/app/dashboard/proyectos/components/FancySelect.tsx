"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type FancySelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type FancySelectProps = {
  options: FancySelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Forces the popover to open upward. By default it auto-detects. */
  openDirection?: "auto" | "up" | "down";
  /** Estilo inline aplicado al trigger (botón). Útil para teñir el borde por fila. */
  triggerStyle?: React.CSSProperties;
};

const TRIGGER_BASE =
  "group relative flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white text-left text-slate-900 shadow-sm transition-all hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

/** Posición calculada del popover, en coordenadas de viewport (`position: fixed`). */
type PopoverPos = {
  left: number;
  width: number;
  /** Se usa `top` al abrir hacia abajo y `bottom` al abrir hacia arriba. */
  top?: number;
  bottom?: number;
  maxHeight: number;
};

const SEPARACION = 6;
const MARGEN_VIEWPORT = 8;
const ALTO_MAXIMO = 280;

export function FancySelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar…",
  ariaLabel,
  className = "",
  size = "md",
  disabled = false,
  openDirection = "auto",
  triggerStyle,
}: FancySelectProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const listboxId = useId();

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const selectableIndexes = useMemo(
    () => options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i !== -1),
    [options]
  );

  const openMenu = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    const currentIdx = options.findIndex((o) => o.value === value);
    setActiveIndex(currentIdx >= 0 ? currentIdx : selectableIndexes[0] ?? -1);
  }, [disabled, options, value, selectableIndexes]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const toggleMenu = useCallback(() => {
    if (open) closeMenu();
    else openMenu();
  }, [open, openMenu, closeMenu]);

  const selectByIndex = useCallback(
    (idx: number) => {
      const opt = options[idx];
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      closeMenu();
      triggerRef.current?.focus();
    },
    [options, onChange, closeMenu]
  );

  // Close on outside click. El popover vive en un portal fuera de `wrapRef`,
  // así que hay que contemplarlo aparte o clickear una opción cerraría el menú
  // antes de que el click llegue a ella.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      closeMenu();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, closeMenu]);

  /**
   * Posición del popover en coordenadas de viewport.
   *
   * Se renderiza en un portal sobre `body` con `position: fixed` en vez de
   * `absolute` dentro del trigger: cualquier ancestro con `overflow` —la tabla
   * de la vista lista, el scroll de las columnas del Kanban— recortaba el menú
   * y dejaba las opciones a medias. Fuera del árbol no hay nada que lo recorte.
   */
  const recalcularPos = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const espacioAbajo = window.innerHeight - r.bottom - MARGEN_VIEWPORT - SEPARACION;
    const espacioArriba = r.top - MARGEN_VIEWPORT - SEPARACION;
    const alturaDeseada = Math.min(ALTO_MAXIMO, options.length * 44 + 12);

    const haciaArriba =
      openDirection === "up"
        ? true
        : openDirection === "down"
          ? false
          : espacioAbajo < alturaDeseada && espacioArriba > espacioAbajo;

    // El menú nunca se sale por el costado: si el trigger está pegado al borde
    // derecho, se corre hacia adentro en vez de desbordar.
    const ancho = Math.max(r.width, 180);
    const left = Math.min(
      Math.max(MARGEN_VIEWPORT, r.left),
      Math.max(MARGEN_VIEWPORT, window.innerWidth - ancho - MARGEN_VIEWPORT)
    );

    setPos({
      left,
      width: ancho,
      ...(haciaArriba
        ? { bottom: window.innerHeight - r.top + SEPARACION }
        : { top: r.bottom + SEPARACION }),
      maxHeight: Math.max(120, Math.min(ALTO_MAXIMO, haciaArriba ? espacioArriba : espacioAbajo)),
    });
  }, [openDirection, options.length]);

  // Sólo se recalcula al abrir. No hace falta limpiar la posición al cerrar: el
  // popover no se renderiza cerrado, y al reabrir este efecto corre antes del
  // paint, así que nunca se llega a ver la posición vieja.
  useLayoutEffect(() => {
    if (!open) return;
    recalcularPos();
  }, [open, recalcularPos]);

  // Mientras está abierto el menú sigue al trigger: `capture` es lo que hace
  // que también se entere del scroll de los contenedores internos, no sólo del
  // de la ventana.
  useEffect(() => {
    if (!open) return;
    const onMove = () => recalcularPos();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, recalcularPos]);

  // Scroll active item into view
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function moveActive(delta: number) {
    if (!options.length) return;
    const enabled = options
      .map((o, i) => (o.disabled ? -1 : i))
      .filter((i) => i !== -1);
    if (!enabled.length) return;
    const currentPos = enabled.indexOf(activeIndex);
    const nextPos =
      currentPos === -1
        ? delta > 0
          ? 0
          : enabled.length - 1
        : (currentPos + delta + enabled.length) % enabled.length;
    setActiveIndex(enabled[nextPos]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openMenu();
      else moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openMenu();
      else moveActive(-1);
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      const first = options.findIndex((o) => !o.disabled);
      if (first >= 0) setActiveIndex(first);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      let last = -1;
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i].disabled) {
          last = i;
          break;
        }
      }
      if (last >= 0) setActiveIndex(last);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openMenu();
      else if (activeIndex >= 0) selectByIndex(activeIndex);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      closeMenu();
    } else if (e.key === "Tab" && open) {
      closeMenu();
    }
  }

  const sizeClasses =
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2.5 text-sm";

  const displayValue = selected?.label;
  const showPlaceholder = !displayValue;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={toggleMenu}
        onKeyDown={onKeyDown}
        style={triggerStyle}
        className={`${TRIGGER_BASE} ${sizeClasses} ${
          open ? "border-[#4FAEB2] ring-2 ring-[#4FAEB2]/20" : ""
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate ${
            showPlaceholder ? "text-slate-400" : "font-medium text-slate-900"
          }`}
        >
          {displayValue ?? placeholder}
        </span>
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[#4FAEB2] transition-all ${
            open
              ? "rotate-180 bg-[#4FAEB2]/10"
              : "bg-transparent group-hover:bg-[#4FAEB2]/8"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && pos && typeof document !== "undefined"
        ? createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
            // El popover cuelga de `body` (portal), así que compite en el stacking
            // context raíz contra los modales (que llegan a z-[120]) y el loader
            // (z-[200]). Debe quedar SIEMPRE por encima: un dropdown que el usuario
            // acaba de abrir tapado por su propio modal = "no se despliega nada".
            zIndex: 1000,
          }}
          // El portal cuelga de `body`, fuera del modal o la fila que lo abrió.
          // Sin frenar la propagación, los cierres por "click afuera" de esos
          // contenedores se dispararían al elegir una opción.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            style={{ maxHeight: pos.maxHeight }}
            className="overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-[#4FAEB2]/15"
          >
            {options.length === 0 ? (
              <li className="px-3 py-3 text-center text-xs text-slate-400">
                Sin opciones
              </li>
            ) : (
              options.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isActive = idx === activeIndex;
                return (
                  <li key={`${opt.value}-${idx}`} role="none">
                    <button
                      type="button"
                      role="option"
                      data-idx={idx}
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onMouseEnter={() => !opt.disabled && setActiveIndex(idx)}
                      onClick={() => selectByIndex(idx)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        opt.disabled
                          ? "cursor-not-allowed text-slate-300"
                          : isActive
                            ? "bg-[#4FAEB2]/10 text-[#2F6E71]"
                            : isSelected
                              ? "text-[#3F8E91]"
                              : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate ${
                            isSelected ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {opt.label}
                        </span>
                        {opt.description ? (
                          <span className="mt-0.5 block truncate text-xs text-slate-500">
                            {opt.description}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4 shrink-0 text-[#4FAEB2]"
                          aria-hidden="true"
                        >
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>,
        document.body
      )
        : null}
    </div>
  );
}
