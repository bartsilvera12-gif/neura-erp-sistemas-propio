"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

/**
 * Piezas visuales del módulo Soporte.
 *
 * Estética de la referencia con la identidad de Zentra: fondo slate muy claro,
 * tarjetas blancas con borde slate-200 y sombra mínima, esquinas moderadas,
 * turquesa como acento. Nada de gradientes ni vidrio.
 */

export const ACENTO = "#4FAEB2";
export const ACENTO_OSC = "#2F6E71";

export const claseInput =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";

export const claseEtiqueta = "mb-1.5 block text-[12px] font-medium text-slate-600";

export function Pagina({ children, ancho = "max-w-[1400px]" }: { children: ReactNode; ancho?: string }) {
  return <div className={`mx-auto w-full ${ancho} px-4 pb-12 pt-6 md:px-8`}>{children}</div>;
}

export function Encabezado({
  titulo,
  subtitulo,
  acciones,
  migas,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acciones?: ReactNode;
  migas?: { etiqueta: string; href?: string }[];
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {migas?.length ? (
          <nav className="mb-1.5 flex items-center gap-1.5 text-[12px] text-slate-400" aria-label="Ruta">
            {migas.map((m, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {m.href ? (
                  <Link href={m.href} className="text-[#2F6E71] no-underline hover:underline">
                    {m.etiqueta}
                  </Link>
                ) : (
                  <span>{m.etiqueta}</span>
                )}
                {i < migas.length - 1 ? <span aria-hidden>›</span> : null}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{titulo}</h1>
        {subtitulo ? <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p> : null}
      </div>
      {acciones ? <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div> : null}
    </header>
  );
}

export function Tarjeta({
  children,
  className = "",
  titulo,
  accion,
  padding = "p-5",
}: {
  children: ReactNode;
  className?: string;
  titulo?: ReactNode;
  accion?: ReactNode;
  padding?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      {titulo ? (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
          {accion}
        </div>
      ) : null}
      <div className={padding}>{children}</div>
    </section>
  );
}

type VarianteBoton = "primario" | "secundario" | "fantasma" | "peligro";

const BOTON: Record<VarianteBoton, string> = {
  primario: "bg-[#4FAEB2] text-white hover:bg-[#3F9A9E] border border-transparent shadow-sm",
  secundario: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
  fantasma: "bg-transparent text-slate-600 border border-transparent hover:bg-slate-100",
  peligro: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50",
};

export function claseBoton(v: VarianteBoton = "primario", tam: "sm" | "md" = "md") {
  const t = tam === "sm" ? "px-2.5 py-1.5 text-[12px]" : "px-3.5 py-2 text-sm";
  return `inline-flex items-center justify-center gap-1.5 rounded-lg font-medium no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${t} ${BOTON[v]}`;
}

export function Boton({
  variante = "primario",
  tam = "md",
  cargando,
  children,
  ...resto
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton; tam?: "sm" | "md"; cargando?: boolean }) {
  return (
    <button type="button" {...resto} disabled={resto.disabled || cargando} className={`${claseBoton(variante, tam)} ${resto.className ?? ""}`}>
      {cargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/**
 * Insignia de estado o prioridad: fondo muy suave del color, texto del color.
 * Discreta a propósito: en una tabla de 20 filas, badges saturados compiten
 * con el asunto, que es lo que se lee.
 */
export function Insignia({ color, children, punto = false }: { color: string; children: ReactNode; punto?: boolean }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-medium"
      style={{ backgroundColor: `${color}1A`, color: oscurecer(color) }}
    >
      {punto ? <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Oscurece un color para usarlo como texto legible sobre su propio fondo suave. */
function oscurecer(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = 0.72;
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

export function Avatar({ nombre, tam = 32 }: { nombre: string | null | undefined; tam?: number }) {
  const w = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  const ini = w.length ? (w[0][0] + (w[1]?.[0] ?? "")).toUpperCase() : "—";
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[#4FAEB2]/12 font-semibold text-[#2F6E71]"
      style={{ width: tam, height: tam, fontSize: Math.max(10, Math.round(tam * 0.36)) }}
      aria-hidden
    >
      {ini}
    </span>
  );
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {texto}
    </div>
  );
}

export function Vacio({ titulo, detalle, accion }: { titulo: string; detalle?: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <p className="text-sm font-medium text-slate-700">{titulo}</p>
      {detalle ? <p className="mt-1 max-w-sm text-[13px] text-slate-500">{detalle}</p> : null}
      {accion ? <div className="mt-4">{accion}</div> : null}
    </div>
  );
}

export function Aviso({ tipo = "error", children }: { tipo?: "error" | "ok" | "info"; children: ReactNode }) {
  const c =
    tipo === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tipo === "ok"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-sky-200 bg-sky-50 text-sky-800";
  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${c}`}>{children}</div>;
}

/** Pestañas que navegan: cada una es un <Link> a su propia ruta. */
export function PestanasRuta({
  items,
  activo,
}: {
  items: { id: string; etiqueta: string; href: string; contador?: number | null }[];
  activo: string;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Secciones">
      {items.map((it) => {
        const sel = it.id === activo;
        return (
          <Link
            key={it.id}
            href={it.href}
            scroll={false}
            aria-current={sel ? "page" : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium no-underline transition-colors ${
              sel ? "border-[#4FAEB2] text-[#2F6E71]" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {it.etiqueta}
            {it.contador != null ? (
              <span
                className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                  sel ? "bg-[#4FAEB2]/15 text-[#2F6E71]" : "bg-slate-100 text-slate-500"
                }`}
              >
                {it.contador}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
