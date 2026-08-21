"use client";

/**
 * Tokens visuales e íconos compartidos por la vista de Observaciones.
 * Mismos valores que usa `ProyectoDetalleInner` — no se introduce ninguna
 * librería de UI nueva.
 */

import type { ReactNode } from "react";

export const ACCENT = "#4FAEB2";
export const ACCENT_HOVER = "#3F8E91";

/**
 * Identidad Zentra. El teal profundo `#0B3A3D` y su acento `#7DCFD2` son los
 * mismos tokens del lateral de la app (`--zentra-sidebar` y
 * `--zentra-sidebar-accent` en globals.css), no colores nuevos.
 *
 * El botón primario usaba `#4FAEB2`, que sobre blanco da 3.83:1 — apenas pasa
 * el mínimo para texto grande y se veía lavado. `#0B3A3D` da 12.45:1.
 */
export const ZENTRA = {
  profundo: "#0B3A3D",
  elevado: "#104A4E",
  acento: "#7DCFD2",
} as const;

export const PANEL_CLS =
  "rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

export const INPUT_CLS =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/25";

export const SELECT_CLS =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/25";

export const BTN_PRIMARY_CLS =
  "inline-flex items-center gap-1.5 rounded-xl bg-[#2F6E71] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#25585B] disabled:cursor-not-allowed disabled:opacity-40";

export const BTN_GHOST_CLS =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]";

// --- Fechas -----------------------------------------------------------------

/** `2026-08-11` → `11 ago`. Sin año cuando es el corriente. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  const t = d.getTime();
  if (!Number.isFinite(t)) return "—";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString("es-AR", opts);
}

export function fechaRelativa(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return "hace instantes";
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `hace ${days} d`;
  if (days < 30) return `hace ${Math.round(days / 7)} sem`;
  if (days < 365) return `hace ${Math.round(days / 30)} m`;
  return `hace ${Math.round(days / 365)} a`;
}

/** La fecha límite ya pasó (comparando por día, no por instante). */
export function estaVencida(fechaLimite: string | null | undefined): boolean {
  if (!fechaLimite) return false;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const d = new Date(`${fechaLimite}T00:00:00`);
  return Number.isFinite(d.getTime()) && d.getTime() < hoy.getTime();
}

/** Iniciales para el avatar del asignado. */
export function iniciales(nombre: string | null | undefined): string {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

/** Color de texto legible sobre un fondo hexadecimal dado. */
export function textoSobre(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#0f172a";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Luminancia relativa simplificada (sRGB), umbral empírico.
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#0f172a" : "#ffffff";
}

// --- Íconos -----------------------------------------------------------------

type IconProps = { size?: number };

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconCheck = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} {...svgProps} strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const IconPlus = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const IconSearch = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="14"
    height="14"
    {...svgProps}
    className={`transition-transform ${open ? "rotate-90" : ""}`}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const IconMessage = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

export const IconImage = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

export const IconClock = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const IconTrash = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const IconFiltro = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

export const IconChevronDown = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const IconCopy = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconPrinter = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

export const IconClonar = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    <rect x="8" y="8" width="14" height="14" rx="2" />
    <path d="M15 12v6M12 15h6" />
  </svg>
);

export const IconList = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

export const IconGrupos = ({ size = 13 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <rect x="3" y="3" width="18" height="7" rx="1.5" />
    <rect x="3" y="14" width="18" height="7" rx="1.5" />
  </svg>
);

export const IconSettings = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// --- Controles de la barra de filtros ---------------------------------------
//
// Los `select` nativos traen la flecha del sistema operativo y un alto que no
// coincide con el resto de los controles, así que se neutraliza la apariencia
// (`appearance-none`) y se dibuja el chevron aparte. Cuando el filtro está
// aplicado el control se pinta de teal: de un vistazo se ve qué está recortando
// el listado y qué no.

export function FiltroSelect({
  etiqueta,
  valor,
  onChange,
  activo,
  bloque = false,
  children,
}: {
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  activo: boolean;
  /** `true` en formularios: ocupa el ancho de su celda. `false` en la barra: se ajusta al texto. */
  bloque?: boolean;
  children: ReactNode;
}) {
  // El chevron se dibuja aparte y se posiciona contra el contenedor, así que el
  // contenedor tiene que medir lo mismo que el `select`: `inline-flex` cuando se
  // ajusta al contenido, `block w-full` cuando ocupa la celda. Si no, la flecha
  // queda flotando lejos del control.
  return (
    <div className={`relative ${bloque ? "block w-full" : "inline-flex"}`}>
      <select
        aria-label={etiqueta}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={`${
          bloque ? "w-full" : "w-auto max-w-[15rem]"
        } appearance-none truncate rounded-xl border py-2 pl-3 pr-8 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 ${
          activo
            ? "border-[#4FAEB2] bg-[#4FAEB2]/10 font-medium text-[#3F8E91]"
            : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60"
        }`}
      >
        {children}
      </select>
      <span
        className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 ${
          activo ? "text-[#3F8E91]" : "text-slate-400"
        }`}
      >
        <IconChevronDown />
      </span>
    </div>
  );
}

/** Filtro booleano. Mismo lenguaje visual que `FiltroSelect` cuando está activo. */
export function FiltroToggle({
  activo,
  onClick,
  children,
  title,
}: {
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
        activo
          ? "border-[#4FAEB2] bg-[#4FAEB2]/10 font-medium text-[#3F8E91]"
          : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60"
      }`}
    >
      {children}
    </button>
  );
}

/** Selector de modo de dos opciones (agrupado / lista). */
export function Segmentado<T extends string>({
  valor,
  onChange,
  opciones,
}: {
  valor: T;
  onChange: (v: T) => void;
  opciones: ReadonlyArray<{ id: T; label: string; icono: ReactNode; title?: string }>;
}) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm">
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={valor === o.id}
          title={o.title}
          className={`inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm transition-colors ${
            valor === o.id
              ? "bg-[#4FAEB2]/10 font-medium text-[#3F8E91]"
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          }`}
        >
          {o.icono}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Acciones secundarias como un bloque único, para que no compitan con los filtros. */
export function GrupoAcciones({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {children}
    </div>
  );
}

export function AccionSecundaria({
  onClick,
  children,
  title,
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
    >
      {children}
    </button>
  );
}
