"use client";

/**
 * Piezas visuales compartidas de Clientes (lista y ficha): chip de código, estado, origen,
 * categoría, avatar con color estable y formatos de fecha / monto.
 */
import { clienteConfig } from "@/erp2/cliente.config";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";

export const TEAL = clienteConfig.color;

/**
 * Pie de acciones de un `<Modal>` (su cuerpo scrollea con p-5): queda pegado abajo mientras se
 * scrollea (también con el teclado abierto en el celular) y, en celular, los botones se
 * reparten el ancho con 44 px de alto. Va como ÚLTIMO hijo del contenido del modal.
 * (`-bottom-5` / `-mx-5 -mb-5` compensan el p-5 del cuerpo: el sticky respeta ese padding.)
 */
export const PIE_MODAL =
  "sticky -bottom-5 z-[2] -mx-5 -mb-5 flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3 max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-auto max-sm:[&>*]:justify-center max-sm:[&>*]:whitespace-nowrap";

export const gs = (v: number | string | null | undefined) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
export const usd = (v: number | string | null | undefined) =>
  `US$ ${(Number(v) || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** dd/mm/yyyy en hora de Paraguay. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric" });
}

/** dd/mm/yyyy hh:mm en hora de Paraguay. */
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const f = d.toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric" });
  const h = d.toLocaleTimeString("es-PY", { timeZone: TZ_PY, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${f} ${h}`;
}

/** Código CL-XXXXXXXX (la base lo genera; por si falta, se arma igual con el id). */
export const codigoCliente = (c: { id: string; codigo?: string | null }) =>
  c.codigo || `CL-${c.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

export type EstadoCliente = "activo" | "inactivo" | "baja";
export const estadoDe = (c: { activo?: boolean | null; baja_at?: string | null }): EstadoCliente =>
  c.baja_at ? "baja" : c.activo === false ? "inactivo" : "activo";

export function CodigoChip({ codigo, fondo = "bg-slate-50" }: { codigo: string; fondo?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md border border-slate-200 ${fondo} px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600`}>
      {codigo}
    </span>
  );
}

export function BadgeEstado({ estado }: { estado: EstadoCliente }) {
  const cfg = {
    activo: { t: "Activo", cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
    inactivo: { t: "Inactivo", cls: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400" },
    baja: { t: "De baja", cls: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  }[estado];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.t}
    </span>
  );
}

export function BadgeOrigen({ origen }: { origen: string | null | undefined }) {
  const o = origen || "MANUAL";
  const cfg: Record<string, { cls: string; dot: string; style?: React.CSSProperties; dotStyle?: React.CSSProperties }> = {
    CRM: { cls: "border-violet-200 bg-violet-50 text-violet-700", dot: "bg-violet-500" },
    VENTA: { cls: "", dot: "", style: { borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1a`, color: TEAL }, dotStyle: { backgroundColor: TEAL } },
    MANUAL: { cls: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
  };
  const it = cfg[o] ?? cfg.MANUAL;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${it.cls}`} style={it.style}>
      <span aria-hidden className={`h-1 w-1 rounded-full ${it.dot}`} style={it.dotStyle} />
      {o}
    </span>
  );
}

export function CategoriaChip({ nombre, color }: { nombre: string | null | undefined; color?: string | null }) {
  if (!nombre) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color || TEAL }} />
      {nombre}
    </span>
  );
}

// Color del avatar según el nombre (estable, no aleatorio).
const AVATAR_TONOS = [
  "TEAL",
  "bg-violet-50 text-violet-700 border border-violet-200",
  "bg-amber-50 text-amber-700 border border-amber-200",
  "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "bg-rose-50 text-rose-700 border border-rose-200",
  "bg-sky-50 text-sky-700 border border-sky-200",
];

export function Avatar({ nombre, size = "sm" }: { nombre: string; size?: "sm" | "lg" }) {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) hash = (hash * 31 + nombre.charCodeAt(i)) | 0;
  const tono = AVATAR_TONOS[Math.abs(hash) % AVATAR_TONOS.length];
  const limpio = nombre.replace(/^[^\p{L}\p{N}]+/u, "");
  if (size === "lg") {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border text-lg font-semibold tracking-tight shadow-sm"
        style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1f`, color: TEAL }}>
        {(limpio.slice(0, 2) || "?").toUpperCase()}
      </div>
    );
  }
  const teal = tono === "TEAL";
  return (
    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${teal ? "border" : tono}`}
      style={teal ? { borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1f`, color: TEAL } : undefined}>
      {(limpio.charAt(0) || "?").toUpperCase()}
    </div>
  );
}
