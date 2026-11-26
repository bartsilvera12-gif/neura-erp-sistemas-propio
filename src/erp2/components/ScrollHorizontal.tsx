"use client";

/**
 * Fila con scroll horizontal (pestañas, chips, atajos, acciones) que NUNCA se corta ni
 * empuja el ancho de la página: si no entra, scrollea adentro, sin barra visible, con un
 * desvanecido en el borde que indica que hay más (máscara: funciona sobre cualquier fondo).
 * Al montar y al cambiar la selección trae a la vista el elemento activo
 * ([aria-selected="true"], [aria-current="page"] o [data-activo="true"]).
 *
 *   <ScrollHorizontal className="rounded-xl bg-slate-100 p-1">
 *     {pestañas…}
 *   </ScrollHorizontal>
 *
 * `className` va al contenedor que scrollea (fondo, padding, gap…). Los hijos quedan en una
 * fila `flex` sin salto de línea (`claseFila` para cambiar el gap).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const ACTIVO = '[aria-selected="true"], [aria-current="page"], [data-activo="true"]';

export function ScrollHorizontal({
  children,
  className = "",
  claseFila = "gap-1",
  role,
  ariaLabel,
  dependencias = [],
}: {
  children: React.ReactNode;
  className?: string;
  claseFila?: string;
  role?: string;
  ariaLabel?: string;
  /** valores que, al cambiar, vuelven a centrar el elemento activo (ej. la pestaña elegida) */
  dependencias?: unknown[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState<{ izq: boolean; der: boolean }>({ izq: false, der: false });

  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const izq = el.scrollLeft > 2;
    const der = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setBordes((b) => (b.izq === izq && b.der === der ? b : { izq, der }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    el.addEventListener("scroll", medir, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", medir);
    };
  }, [medir]);

  // El activo, a la vista (sin mover la página: sólo el scroll interno).
  useLayoutEffect(() => {
    const el = ref.current;
    const act = el?.querySelector<HTMLElement>(ACTIVO);
    if (!el || !act) return;
    const r = act.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (r.left < c.left + 16) el.scrollLeft -= c.left + 16 - r.left;
    else if (r.right > c.right - 16) el.scrollLeft += r.right - (c.right - 16);
    medir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencias);

  const fade = 24;
  const mascara =
    bordes.izq || bordes.der
      ? `linear-gradient(to right, ${bordes.izq ? "transparent" : "#000"} 0, #000 ${bordes.izq ? fade : 0}px, #000 calc(100% - ${bordes.der ? fade : 0}px), ${bordes.der ? "transparent" : "#000"} 100%)`
      : undefined;

  return (
    <div
      ref={ref}
      role={role}
      aria-label={ariaLabel}
      className={`scroll-x-oculto max-w-full ${className}`}
      style={mascara ? { maskImage: mascara, WebkitMaskImage: mascara } : undefined}
    >
      <div className={`flex w-max min-w-full flex-nowrap ${claseFila}`}>{children}</div>
    </div>
  );
}
