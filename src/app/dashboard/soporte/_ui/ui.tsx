"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import BlurText from "@/components/reactbits/BlurText";

/**
 * Sistema visual del módulo Soporte.
 *
 * La primera versión quedó correcta pero apagada: todo gris sobre blanco, y
 * ninguna pista visual de qué es cada cosa. Acá el color tiene TRABAJO: cada
 * concepto tiene su tono (QA violeta, Desarrollo celeste, lo resuelto verde, lo
 * vencido rojo) y ese tono se repite en íconos, insignias y gráficos, así que
 * se lee de un vistazo sin tener que leer la etiqueta.
 *
 * Base de Zentra: turquesa como acento, fondos claros, bordes finos. Los efectos
 * de React Bits van donde suman —la luz que sigue al cursor en tarjetas
 * clickeables, los números que cuentan, el título que entra— y no en todo.
 */

export const ACENTO = "#4FAEB2";
export const ACENTO_OSC = "#2F6E71";

// ------------------------------------------------------------------------ tonos

export type Tono = "turquesa" | "celeste" | "azul" | "violeta" | "ambar" | "naranja" | "verde" | "rosa" | "pizarra" | "indigo";

export const TONOS: Record<Tono, { suave: string; texto: string; borde: string; solido: string; hex: string; foco: `rgba(${number}, ${number}, ${number}, ${number})` }> = {
  turquesa: { suave: "bg-[#4FAEB2]/12", texto: "text-[#2F6E71]", borde: "border-[#4FAEB2]/30", solido: "bg-[#4FAEB2]", hex: "#4FAEB2", foco: "rgba(79, 174, 178, 0.18)" },
  celeste: { suave: "bg-sky-100", texto: "text-sky-700", borde: "border-sky-200", solido: "bg-sky-500", hex: "#0ea5e9", foco: "rgba(14, 165, 233, 0.16)" },
  azul: { suave: "bg-blue-100", texto: "text-blue-700", borde: "border-blue-200", solido: "bg-blue-500", hex: "#3b82f6", foco: "rgba(59, 130, 246, 0.16)" },
  violeta: { suave: "bg-violet-100", texto: "text-violet-700", borde: "border-violet-200", solido: "bg-violet-500", hex: "#8b5cf6", foco: "rgba(139, 92, 246, 0.16)" },
  ambar: { suave: "bg-amber-100", texto: "text-amber-700", borde: "border-amber-200", solido: "bg-amber-500", hex: "#f59e0b", foco: "rgba(245, 158, 11, 0.18)" },
  naranja: { suave: "bg-orange-100", texto: "text-orange-700", borde: "border-orange-200", solido: "bg-orange-500", hex: "#f97316", foco: "rgba(249, 115, 22, 0.16)" },
  verde: { suave: "bg-emerald-100", texto: "text-emerald-700", borde: "border-emerald-200", solido: "bg-emerald-500", hex: "#10b981", foco: "rgba(16, 185, 129, 0.16)" },
  rosa: { suave: "bg-rose-100", texto: "text-rose-700", borde: "border-rose-200", solido: "bg-rose-500", hex: "#f43f5e", foco: "rgba(244, 63, 94, 0.16)" },
  pizarra: { suave: "bg-slate-100", texto: "text-slate-700", borde: "border-slate-200", solido: "bg-slate-600", hex: "#475569", foco: "rgba(71, 85, 105, 0.14)" },
  indigo: { suave: "bg-indigo-100", texto: "text-indigo-700", borde: "border-indigo-200", solido: "bg-indigo-500", hex: "#6366f1", foco: "rgba(99, 102, 241, 0.16)" },
};

/** Colores del gráfico de tipos. Vive acá, y no junto a recharts, para no arrastrar la librería al cargar la página. */
export const PALETA_TIPOS = ["#4FAEB2", "#8b5cf6", "#f59e0b", "#0ea5e9", "#f43f5e", "#10b981", "#6366f1"];

/** Tono de cada estado del flujo, para los que no traen color propio. */
export const TONO_ESTADO: Record<string, Tono> = {
  registrado: "pizarra",
  clasificado: "azul",
  en_desarrollo: "celeste",
  en_qa: "violeta",
  con_observaciones: "naranja",
  resuelto: "verde",
  cerrado: "pizarra",
};

/** Tono por área de trabajo: el mismo en avatares, comentarios y equipos. */
export const TONO_AREA: Record<string, Tono> = {
  Desarrollo: "celeste",
  QA: "violeta",
  PM: "turquesa",
  Admin: "ambar",
  Equipo: "pizarra",
};

// ----------------------------------------------------------------------- formas

export const claseInput =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition focus:border-[#4FAEB2] focus:outline-none focus:ring-4 focus:ring-[#4FAEB2]/15";

export const claseEtiqueta = "mb-1.5 block text-[12px] font-semibold text-slate-600";

export function Pagina({ children, ancho = "max-w-[1400px]" }: { children: ReactNode; ancho?: string }) {
  return <div className={`mx-auto w-full ${ancho} px-4 pb-14 pt-6 md:px-8`}>{children}</div>;
}

export function IconoTile({ icono: Icono, tono = "turquesa", tam = "md" }: { icono: LucideIcon; tono?: Tono; tam?: "sm" | "md" | "lg" }) {
  const t = TONOS[tono];
  const caja = tam === "lg" ? "h-12 w-12 rounded-2xl" : tam === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl";
  const ic = tam === "lg" ? "h-6 w-6" : tam === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <span className={`grid shrink-0 place-items-center ${caja} ${t.suave} ${t.texto}`} aria-hidden>
      <Icono className={ic} strokeWidth={2.1} />
    </span>
  );
}

export function Encabezado({
  titulo,
  subtitulo,
  acciones,
  migas,
  icono,
  tono = "turquesa",
  animar = true,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  acciones?: ReactNode;
  migas?: { etiqueta: string; href?: string }[];
  icono?: LucideIcon;
  tono?: Tono;
  animar?: boolean;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        {icono ? <IconoTile icono={icono} tono={tono} tam="lg" /> : null}
        <div className="min-w-0">
          {migas?.length ? (
            <nav className="mb-0.5 flex items-center gap-1.5 text-[12px] text-slate-400" aria-label="Ruta">
              {migas.map((m, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {m.href ? (
                    <Link href={m.href} className="font-medium text-[#2F6E71] no-underline hover:underline">
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
          {animar ? (
            <>
              {/* BlurText renderiza un <p>, que no puede vivir dentro de un <h1>:
                  el título real queda para lectores de pantalla y la animación
                  va como capa visual. Entra corta (≈0,35 s) y con poco
                  recorrido: da vida sin hacer esperar a nadie para leer. */}
              <h1 className="sr-only">{titulo}</h1>
              <div aria-hidden className="text-[24px] font-bold leading-tight tracking-tight text-slate-900">
                <BlurText
                  text={titulo}
                  delay={40}
                  stepDuration={0.17}
                  animateBy="words"
                  direction="top"
                  animationFrom={{ filter: "blur(6px)", opacity: 0, y: -8 }}
                  animationTo={[{ filter: "blur(2px)", opacity: 0.6, y: 1 }, { filter: "blur(0px)", opacity: 1, y: 0 }]}
                />
              </div>
            </>
          ) : (
            <h1 className="text-[24px] font-bold leading-tight tracking-tight text-slate-900">{titulo}</h1>
          )}
          {subtitulo ? <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p> : null}
        </div>
      </div>
      {acciones ? <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div> : null}
    </header>
  );
}

export function Tarjeta({
  children,
  className = "",
  titulo,
  icono,
  tono = "turquesa",
  accion,
  padding = "p-5",
}: {
  children: ReactNode;
  className?: string;
  titulo?: ReactNode;
  icono?: LucideIcon;
  tono?: Tono;
  accion?: ReactNode;
  padding?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)] ${className}`}>
      {titulo ? (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <h2 className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
            {icono ? <IconoTile icono={icono} tono={tono} tam="sm" /> : null}
            {titulo}
          </h2>
          {accion}
        </div>
      ) : null}
      <div className={padding}>{children}</div>
    </section>
  );
}

/** Tarjeta clickeable con la luz de React Bits siguiendo al cursor. */
export function TarjetaViva({ children, tono = "turquesa", className = "" }: { children: ReactNode; tono?: Tono; className?: string }) {
  return (
    <SpotlightCard
      spotlightColor={TONOS[tono].foco}
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)] transition-shadow hover:shadow-[0_2px_6px_rgba(15,23,42,0.06),0_14px_32px_-14px_rgba(15,23,42,0.18)] ${className}`}
    >
      {children}
    </SpotlightCard>
  );
}

type VarianteBoton = "primario" | "secundario" | "fantasma" | "peligro";

const BOTON: Record<VarianteBoton, string> = {
  primario:
    "bg-[#4FAEB2] text-white hover:bg-[#439A9E] border border-transparent shadow-[0_6px_16px_-6px_rgba(79,174,178,0.75)] active:translate-y-px",
  secundario: "bg-white text-slate-700 border border-slate-200 hover:border-[#4FAEB2]/50 hover:bg-[#4FAEB2]/5 hover:text-[#2F6E71]",
  fantasma: "bg-transparent text-slate-600 border border-transparent hover:bg-slate-100",
  peligro: "bg-white text-rose-600 border border-rose-200 hover:bg-rose-50",
};

export function claseBoton(v: VarianteBoton = "primario", tam: "sm" | "md" = "md") {
  const t = tam === "sm" ? "px-2.5 py-1.5 text-[12px]" : "px-4 py-2 text-sm";
  return `inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold no-underline transition disabled:cursor-not-allowed disabled:opacity-50 ${t} ${BOTON[v]}`;
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

/** Insignia de estado o prioridad con el color que trae el catálogo. */
export function Insignia({ color, children, punto = false, icono: Icono }: { color: string; children: ReactNode; punto?: boolean; icono?: LucideIcon }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset"
      style={{ backgroundColor: `${color}1F`, color: oscurecer(color), ["--tw-ring-color" as string]: `${color}40` }}
    >
      {punto ? <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden /> : null}
      {Icono ? <Icono className="h-3 w-3 shrink-0" aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function oscurecer(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = 0.66;
  return `rgb(${Math.round(((n >> 16) & 255) * f)}, ${Math.round(((n >> 8) & 255) * f)}, ${Math.round((n & 255) * f)})`;
}

const PALETA_AVATAR: Tono[] = ["turquesa", "celeste", "violeta", "ambar", "verde", "rosa", "indigo", "naranja", "azul"];

/**
 * Avatar con color propio y estable por persona: el mismo nombre da siempre el
 * mismo color, así que en una conversación larga se sigue quién habla sin leer.
 */
export function Avatar({ nombre, tam = 32, tono }: { nombre: string | null | undefined; tam?: number; tono?: Tono }) {
  const limpio = (nombre ?? "").trim();
  const w = limpio.split(/\s+/).filter(Boolean);
  const ini = w.length ? (w[0][0] + (w[1]?.[0] ?? "")).toUpperCase() : "—";
  let h = 0;
  for (const c of limpio) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const t = TONOS[tono ?? PALETA_AVATAR[h % PALETA_AVATAR.length]];
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold ring-2 ring-white ${t.suave} ${t.texto}`}
      style={{ width: tam, height: tam, fontSize: Math.max(10, Math.round(tam * 0.36)) }}
      aria-hidden
    >
      {ini}
    </span>
  );
}

// -------------------------------------------------------------------- estados

/** Esqueleto con brillo: se percibe más rápido que un "Cargando…". */
export function Esqueleto({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100 ${className}`} />;
}

export function Cargando({ filas = 5 }: { filas?: number; texto?: string }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Esqueleto className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Esqueleto className="h-3 w-2/5" />
            <Esqueleto className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Vacio({ titulo, detalle, accion, icono: Icono, tono = "turquesa" }: { titulo: string; detalle?: string; accion?: ReactNode; icono?: LucideIcon; tono?: Tono }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      {Icono ? (
        <span className={`mb-3 grid h-14 w-14 place-items-center rounded-2xl ${TONOS[tono].suave} ${TONOS[tono].texto}`}>
          <Icono className="h-7 w-7" aria-hidden />
        </span>
      ) : null}
      <p className="text-sm font-semibold text-slate-700">{titulo}</p>
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
  return <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${c}`}>{children}</div>;
}

/** Pestañas-píldora que navegan: cada una es un <Link> a su propia ruta. */
export function PestanasRuta({
  items,
  activo,
}: {
  items: { id: string; etiqueta: string; href: string; contador?: number | null; icono?: LucideIcon }[];
  activo: string;
}) {
  return (
    <nav className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 p-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] backdrop-blur" aria-label="Secciones">
      {items.map((it) => {
        const sel = it.id === activo;
        const Icono = it.icono;
        return (
          <Link
            key={it.id}
            href={it.href}
            scroll={false}
            aria-current={sel ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold no-underline transition ${
              sel ? "bg-[#4FAEB2] text-white shadow-[0_6px_16px_-8px_rgba(79,174,178,0.9)]" : "text-slate-500 hover:bg-[#4FAEB2]/8 hover:text-[#2F6E71]"
            }`}
          >
            {Icono ? <Icono className="h-4 w-4" aria-hidden /> : null}
            {it.etiqueta}
            {it.contador != null ? (
              <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${sel ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"}`}>
                {it.contador}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
