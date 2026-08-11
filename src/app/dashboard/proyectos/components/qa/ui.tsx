"use client";

/**
 * Tokens visuales e íconos compartidos por la vista de Observaciones.
 * Mismos valores que usa `ProyectoDetalleInner` — no se introduce ninguna
 * librería de UI nueva.
 */

export const ACCENT = "#4FAEB2";
export const ACCENT_HOVER = "#3F8E91";

export const PANEL_CLS =
  "rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

export const INPUT_CLS =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";

export const SELECT_CLS =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";

export const BTN_PRIMARY_CLS =
  "inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-60";

export const BTN_GHOST_CLS =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/50 hover:text-[#3F8E91]";

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

export const IconSettings = ({ size = 14 }: IconProps) => (
  <svg width={size} height={size} {...svgProps}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
